/*=========================================================
    Nikon Picture Control Studio - Display Canvas (Centrage Dynamique)
=========================================================*/

class DisplayCanvas {

    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext("2d", { alpha: false });

        this.offscreenCanvas = document.createElement("canvas");
        this.offscreenCtx = this.offscreenCanvas.getContext("2d");

        this.scale = 1;
        this.minScale = 0.05;
        this.maxScale = 5; // 500% : cohérent avec le max du slider, pleinement exploitable net grâce au zoom pleine résolution
        this.panX = 0;
        this.panY = 0;

        // 🔹 Zoom pleine résolution : au-delà de ce seuil, on demande à l'appelant
        // (voir this.onRequestFullRes, branché par ImageProcessor) de charger la
        // source en pleine résolution plutôt que l'aperçu réduit, pour éviter le
        // flou d'agrandissement. this.onRequestFullRes doit retourner une Promise ;
        // ce fichier reste centré sur l'affichage, pas le chargement de données.
        this.ZOOM_FULLRES_THRESHOLD = 1.5;
        this.onRequestFullRes = null;
        this._fullResRequested = false;
        this._fullResIndicator = null;

        // 🔹 Référence FIXE (largeur/hauteur de l'aperçu au moment où la photo est
        // chargée), établie une seule fois par photo dans draw() et JAMAIS modifiée
        // par un swap aperçu -> pleine résolution. this.scale est TOUJOURS exprimé en
        // pourcentage de CETTE référence (voir _getRenderScale) : c'est ce qui garantit
        // qu'un même pourcentage affiché (ex: 172%) correspond en permanence au même
        // cadrage visuel, que la source active soit l'aperçu réduit ou la pleine
        // résolution. Sans ça, this.scale appliqué directement à offscreenCanvas.width
        // change de sens dès que ce buffer change de taille (bug de cadrage).
        this._refWidth = null;
        this._refHeight = null;

        // 🔹 Résolution NATIVE réelle de la photo (capteur/fichier), INDÉPENDANTE
        // du buffer actuellement chargé — renseignée dès que connue (EXIF, voir
        // setTrueImageResolution()/ImageProcessor.load()), jamais dérivée d'un
        // buffer décodé. this.scale/_refWidth ci-dessus servent au RENDU (position/
        // échelle réelles sur le canevas, inchangé) ; trueImageWidth/Height servent
        // UNIQUEMENT au POURCENTAGE AFFICHÉ (voir _getDisplayPercent()) — sans ça,
        // le pourcentage affiché à l'utilisateur reflète la taille de l'aperçu
        // réduit (ex: 1600px) au lieu de la vraie résolution du capteur (ex:
        // 6032px), donnant des valeurs incohérentes façon "124%" au lieu de "~26%".
        this.trueImageWidth = null;
        this.trueImageHeight = null;

        this.transform = { rotation: 0, flipH: false, flipV: false };

        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;

        this.isRenderPending = false;

        this.initZoomSliderUI();
        this.initEvents();
        this.setupResizeObserver();
    }

    setTransform(transform) {
        if (transform) {
            this.transform = { ...transform };
            this.requestRender();
        }
    }

    setupResizeObserver() {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        const observer = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const w = Math.floor(entry.contentRect.width);
                const h = Math.floor(entry.contentRect.height);

                if (w > 0 && h > 0 && (this.canvas.width !== w || this.canvas.height !== h)) {
                    this.canvas.width = w;
                    this.canvas.height = h;
                    if (this.offscreenCanvas.width > 0) {
                        this.requestRender();
                    }
                }
            }
        });

        observer.observe(parent);
    }

    initZoomSliderUI() {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        const zoomBarId = "canvasZoomBar_" + this.canvas.id;

        let zoomBar = document.getElementById(zoomBarId);
        if (!zoomBar) {
            zoomBar = document.createElement("div");
            zoomBar.id = zoomBarId;
            zoomBar.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                padding: 6px 12px;
                background: #181818;
                border-top: 1px solid #333;
                width: 100%;
                box-sizing: border-box;
                user-select: none;
                flex-shrink: 0;
            `;

            zoomBar.innerHTML = `
                <span style="color:#aaa; font-size:12px; font-weight:bold;">Zoom :</span>
                <input type="range" class="canvas-zoom-range" min="5" max="500" value="100" step="1" 
                       style="flex: 1; max-width: 250px; cursor: pointer;">
                <span class="canvas-zoom-text" style="color:#fff; font-size:11px; min-width: 45px; text-align: right;">100%</span>
                <button class="canvas-zoom-reset btn-tool" style="padding: 2px 8px; font-size: 11px;">Ajuster</button>
            `;

            const previewPanel = this.canvas.closest(".preview-panel") || parent;
            const exifBar = previewPanel.querySelector(".exif-bar");
            if (exifBar) {
                previewPanel.insertBefore(zoomBar, exifBar);
            } else {
                previewPanel.appendChild(zoomBar);
            }
        }

        this.zoomSlider = zoomBar.querySelector(".canvas-zoom-range");
        this.zoomText = zoomBar.querySelector(".canvas-zoom-text");
        this.btnReset = zoomBar.querySelector(".canvas-zoom-reset");

        if (this.zoomSlider) {
            this.zoomSlider.oninput = (e) => {
                const percent = parseFloat(e.target.value);
                if (!isNaN(percent)) {
                    // 🔹 Le curseur affiche/saisit un pourcentage RÉEL (voir
                    // _getDisplayPercent()) — passe par l'inverse pour obtenir le
                    // this.scale correspondant, sinon le curseur "rebondit" au
                    // glissement (voir _displayPercentToScale()).
                    this.setZoomScale(this._displayPercentToScale(percent));
                }
            };
        }

        if (this.btnReset) {
            this.btnReset.onclick = () => this.resetZoom();
        }
    }

    /**
     * 🔹 Point centralisé UNIQUE de modification de this.scale (voir point 3) :
     * garantit que le curseur/texte de pourcentage (updateZoomUI) reste TOUJOURS
     * synchronisé avec this.scale, quel que soit l'appelant (molette, curseur,
     * resetZoom...). Aucun autre endroit du fichier ne doit écrire this.scale
     * directement.
     */
    _setScale(value) {
        this.scale = value;
        this.updateZoomUI();
    }

    /**
     * 🔹 Convertit this.scale (pourcentage STABLE, relatif à this._refWidth, voir
     * constructeur) en scale RÉEL à appliquer par ctx.scale()/drawImage() sur le
     * buffer actuellement chargé (this.offscreenCanvas, aperçu OU pleine résolution).
     * this._refWidth ne bouge jamais après le chargement de la photo, donc quand
     * offscreenCanvas.width change (swap de résolution), ce facteur de conversion
     * absorbe intégralement le changement : this.scale n'a JAMAIS besoin d'être
     * réajusté au moment du swap, et un même pourcentage revisité plus tard
     * redonne exactement le même cadrage visuel.
     */
    _getRenderScale(scaleOverride = null) {
        const imgW = this.offscreenCanvas.width;
        const s = scaleOverride !== null ? scaleOverride : this.scale;
        if (!imgW) return s;
        const refW = this._refWidth || imgW;
        return s * (refW / imgW);
    }

    setZoomScale(targetScale, focalX = null, focalY = null) {
        if (!this.offscreenCanvas.width || !this.canvas.width) return;

        // 🔹 minScale/maxScale (0.05-5, soit 5%-500%) bornent le POURCENTAGE RÉEL
        // affiché, PAS this.scale brut directement — sinon, pour une photo dont
        // _refWidth (aperçu réduit) est beaucoup plus petit que trueImageWidth
        // (résolution native, ex: ratio ~1/9.5 pour un aperçu 424px d'une photo
        // 4032px), maxScale=5 plafonnerait le pourcentage réel atteignable bien
        // en dessous de 500% (ex: ~53%), empêchant même d'atteindre le seuil
        // pleine résolution de 150% en tournant la molette/glissant le curseur.
        // Repli sur l'ancien comportement (borne directe sur this.scale) tant que
        // la résolution réelle n'est pas connue, via _getDisplayPercent()/
        // _displayPercentToScale() (voir plus bas, identité quand trueImageWidth
        // est absent).
        const targetPercent = this._getDisplayPercent(targetScale);
        const safePercent = Math.min(Math.max(this.minScale * 100, targetPercent), this.maxScale * 100);
        const safeScale = this._displayPercentToScale(safePercent);

        if (focalX !== null && focalY !== null) {
            const w = this.canvas.width;
            const h = this.canvas.height;
            const imgW = this.offscreenCanvas.width;
            const imgH = this.offscreenCanvas.height;

            const oldRenderScale = this._getRenderScale();
            const oldDrawX = (w - imgW * oldRenderScale) / 2 + this.panX;
            const oldDrawY = (h - imgH * oldRenderScale) / 2 + this.panY;

            const imgMouseX = (focalX - oldDrawX) / oldRenderScale;
            const imgMouseY = (focalY - oldDrawY) / oldRenderScale;

            this._setScale(safeScale);
            const newRenderScale = this._getRenderScale();

            const newDrawX = focalX - imgMouseX * newRenderScale;
            const newDrawY = focalY - imgMouseY * newRenderScale;

            this.panX = newDrawX - (w - imgW * newRenderScale) / 2;
            this.panY = newDrawY - (h - imgH * newRenderScale) / 2;
        } else {
            this._setScale(safeScale);
        }

        this.requestRender();
        this._maybeRequestFullRes();
    }

    /**
     * 🔹 Déclenche this.onRequestFullRes() une seule fois par photo lorsque le
     * zoom dépasse UN DES DEUX seuils suivants (flag this._fullResRequested,
     * remis à zéro uniquement pour une NOUVELLE photo, voir draw()) — pas de
     * rechargement en boucle pendant qu'on tourne la molette au-dessus du seuil :
     *
     * 1. Pourcentage RÉEL (_getDisplayPercent(), relatif à la vraie résolution
     *    native) >= 150% — garantit qu'on bascule au plus tard à ce niveau de
     *    zoom "objectif", cohérent avec le pourcentage affiché à l'utilisateur.
     * 2. this.scale BRUT (relatif à _refWidth, le buffer aperçu réduit CHARGÉ
     *    EN PREMIER pour cette photo — voir le constructeur) >= 1.5 — évite
     *    d'étirer visiblement l'aperçu réduit bien au-delà de sa propre
     *    résolution native avant de basculer, même quand le ratio aperçu/photo
     *    réelle est grand (ex: aperçu 640px pour une photo 6032px, ratio ~9,4×)
     *    et que le seuil 1 seul ne serait franchi qu'à un étirement ~16× de
     *    l'aperçu — flou visible pendant tout ce trajet de zoom (constaté en
     *    conditions réelles, voir logs de diagnostic).
     *
     * Le premier des deux seuils atteint déclenche la bascule — chacun protège
     * un aspect différent (fidélité au pourcentage annoncé vs netteté visuelle
     * pendant le zoom), donc on ne remplace pas l'un par l'autre, on prend le
     * plus tôt des deux.
     */
    _maybeRequestFullRes() {
        const displayPercent = this._getDisplayPercent();
        const realThresholdPercent = this.ZOOM_FULLRES_THRESHOLD * 100;
        const crossedReal = displayPercent > realThresholdPercent;
        const crossedBuffer = this.scale > this.ZOOM_FULLRES_THRESHOLD;

        if (!crossedReal && !crossedBuffer) return;
        if (this._fullResRequested) return;
        if (typeof this.onRequestFullRes !== "function") return;

        this._fullResRequested = true;
        this._setFullResLoading(true);

        Promise.resolve(this.onRequestFullRes())
            .catch((err) => console.error("❌ Erreur chargement pleine résolution (zoom) :", err))
            .finally(() => this._setFullResLoading(false));
    }

    _ensureFullResIndicator() {
        if (this._fullResIndicator) return this._fullResIndicator;

        const parent = this.canvas.parentElement;
        if (!parent) return null;

        const el = document.createElement("div");
        el.className = "fullres-loading-indicator";
        el.textContent = "Chargement pleine résolution...";
        el.style.cssText = `
            position: absolute;
            top: 8px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.75);
            color: #fff;
            font-size: 12px;
            padding: 4px 10px;
            border-radius: 4px;
            pointer-events: none;
            display: none;
            z-index: 5;
        `;
        parent.appendChild(el);
        this._fullResIndicator = el;
        return el;
    }

    _setFullResLoading(isLoading) {
        const el = this._ensureFullResIndicator();
        if (el) el.style.display = isLoading ? "block" : "none";
    }

    updateZoomUI() {
        const percent = Math.round(this._getDisplayPercent());
        if (this.zoomSlider) this.zoomSlider.value = percent;
        if (this.zoomText) this.zoomText.textContent = `${percent}%`;
    }

    /**
     * 🔹 Résolution native réelle de la photo (capteur/fichier), connue via EXIF
     * — voir ImageProcessor.load(). Appelable AVANT ou APRÈS le premier draw()
     * (rafraîchit l'affichage immédiatement si déjà dessiné) : dans le flux normal
     * elle est connue avant (EXIF lu avant load()), donc aucun "flash" du mauvais
     * pourcentage au premier affichage. TOUJOURS réassigné, même à null/undefined
     * (EXIF absent pour CETTE photo) — sans ça, la résolution réelle de la photo
     * PRÉCÉDENTE resterait appliquée par erreur à la nouvelle (repli silencieux
     * sur l'ancien comportement dans ce cas, voir _getDisplayPercent()).
     */
    setTrueImageResolution(width, height) {
        this.trueImageWidth = width || null;
        this.trueImageHeight = height || null;
        this.updateZoomUI();
    }

    /**
     * 🔹 Convertit this.scale (pourcentage STABLE relatif à _refWidth — le buffer
     * chargé EN PREMIER pour cette photo, gelé pour toute sa durée de vie, voir le
     * commentaire du constructeur) en pourcentage RÉEL par rapport à la vraie
     * résolution native. Utilise _refWidth, PAS offscreenCanvas.width (le buffer
     * COURANT, qui lui change lors d'un swap aperçu -> pleine résolution) : c'est
     * ce qui garantit qu'aucun saut de valeur affichée ne se produit à ce moment
     * précis, puisque this.scale et _refWidth restent inchangés par ce swap (seul
     * offscreenCanvas.width change — voir _getRenderScale() qui absorbe déjà ce
     * changement côté rendu, indépendamment de ce calcul-ci côté affichage).
     * Repli sur l'ancien comportement (pourcentage relatif à _refWidth directement)
     * si la résolution réelle n'est pas encore connue (EXIF absent/en échec).
     */
    _getDisplayPercent(scaleOverride = null) {
        const scale = scaleOverride !== null ? scaleOverride : (this.scale || 1);
        if (!this.trueImageWidth || !this._refWidth) return scale * 100;
        return scale * (this._refWidth / this.trueImageWidth) * 100;
    }

    /**
     * 🔹 Inverse de _getDisplayPercent() : convertit un pourcentage RÉEL saisi par
     * l'utilisateur (curseur de zoom) en this.scale (relatif à _refWidth). Sans
     * cet inverse, glisser le curseur à "50" appellerait setZoomScale(0.5) —
     * interprété comme 50% de _refWidth au lieu de 50% de la résolution réelle —
     * et updateZoomUI() re-synchroniserait aussitôt le curseur sur une tout autre
     * valeur affichée, donnant un curseur qui "rebondit" au glissement.
     */
    _displayPercentToScale(percent) {
        if (!this.trueImageWidth || !this._refWidth) return percent / 100;
        return (percent / 100) * (this.trueImageWidth / this._refWidth);
    }

    initEvents() {
        if (!this.canvas) return;

        const targetContainer = this.canvas.parentElement || this.canvas;

        targetContainer.addEventListener("wheel", (e) => {
            e.preventDefault();

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomSensitivity = 0.0015;
            const delta = -e.deltaY * zoomSensitivity;
            const targetScale = this.scale * Math.exp(delta);

            this.setZoomScale(targetScale, mouseX, mouseY);
        }, { passive: false });

        targetContainer.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;

            // Interception par le contrôleur de masque
            const controller = window.imageProcessor?.maskController || window.masksController;
            if (controller && typeof controller.shouldInterceptMouseEvent === "function") {
                if (controller.shouldInterceptMouseEvent(e.clientX, e.clientY)) {
                    e.stopImmediatePropagation();
                    return;
                }
            }

            this.isDragging = true;
            this.startX = e.clientX - this.panX;
            this.startY = e.clientY - this.panY;
            this.canvas.style.cursor = "grabbing";
        }, true);

        window.addEventListener("mousemove", (e) => {
            if (!this.isDragging) return;
            this.panX = e.clientX - this.startX;
            this.panY = e.clientY - this.startY;
            this.requestRender();
        });

        window.addEventListener("mouseup", () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.canvas.style.cursor = "default";
            }
        });
    }

    draw(imageData, opts = {}) {
        if (!imageData) return;

        const isNewImage = (this.offscreenCanvas.width !== imageData.width || this.offscreenCanvas.height !== imageData.height);

        // 🔹 preserveView : la source change de résolution (aperçu -> pleine résolution,
        // voir ImageProcessor.render()/onRequestFullRes) mais reste la MÊME photo — on
        // garde le cadrage actuel plutôt que de recentrer/dézoomer comme pour une
        // nouvelle photo. Aucun recalcul de this.scale n'est nécessaire ici : this._refWidth
        // (voir constructeur) reste fixé à la résolution de l'aperçu initial, donc
        // _getRenderScale() absorbe seul le changement de offscreenCanvas.width et le
        // cadrage visuel reste identique automatiquement.
        const isResolutionSwap = isNewImage && !!opts.preserveView && this.offscreenCanvas.width > 0;

        this.offscreenCanvas.width = imageData.width;
        this.offscreenCanvas.height = imageData.height;
        this.offscreenCtx.putImageData(imageData, 0, 0);

        const parent = this.canvas.parentElement;
        if (parent) {
            const w = Math.floor(parent.clientWidth);
            const h = Math.floor(parent.clientHeight);
            if (w > 0 && h > 0 && (this.canvas.width !== w || this.canvas.height !== h)) {
                this.canvas.width = w;
                this.canvas.height = h;
            }
        }

        if (isResolutionSwap) {
            this.requestRender();
        } else if (isNewImage || !this.scale) {
            this._fullResRequested = false;
            // 🔹 Référence figée UNE SEULE FOIS par photo, à la résolution du buffer
            // initialement affiché (l'aperçu réduit) — jamais mise à jour ensuite (voir
            // _getRenderScale). C'est ce qui rend le pourcentage affiché stable dans le
            // temps, y compris après un swap vers la pleine résolution.
            this._refWidth = imageData.width;
            this._refHeight = imageData.height;
            this.resetZoom();
        } else {
            this.requestRender();
        }
    }

    requestRender() {
        if (!this.isRenderPending) {
            this.isRenderPending = true;
            requestAnimationFrame(() => {
                this.render();
                this.isRenderPending = false;
            });
        }
    }

    render() {
        if (!this.ctx || !this.offscreenCanvas.width || !this.canvas.width) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const imgW = this.offscreenCanvas.width;
        const imgH = this.offscreenCanvas.height;
        const renderScale = this._getRenderScale();

        this.ctx.fillStyle = "#141414";
        this.ctx.fillRect(0, 0, w, h);

        this.ctx.save();

        const drawX = (w - imgW * renderScale) / 2 + this.panX;
        const drawY = (h - imgH * renderScale) / 2 + this.panY;

        this.ctx.translate(drawX, drawY);
        this.ctx.scale(renderScale, renderScale);

        const centerX = imgW / 2;
        const centerY = imgH / 2;

        this.ctx.translate(centerX, centerY);
        this.ctx.rotate((this.transform.rotation * Math.PI) / 180);
        this.ctx.scale(
            this.transform.flipH ? -1 : 1,
            this.transform.flipV ? -1 : 1
        );
        this.ctx.translate(-centerX, -centerY);

        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = "high";

        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        this.ctx.restore();
    }

    resetZoom() {
        if (!this.offscreenCanvas.width || !this.canvas.width) return;

        const containerW = this.canvas.width;
        const containerH = this.canvas.height;
        // 🔹 Le "fit" se calcule TOUJOURS par rapport à this._refWidth/_refHeight (voir
        // _getRenderScale), pas par rapport à offscreenCanvas.width/height courant :
        // sinon, cliquer "Ajuster" après un swap pleine résolution recalculerait le
        // fit dans le mauvais référentiel et casserait la cohérence du pourcentage.
        const refW = this._refWidth || this.offscreenCanvas.width;
        const refH = this._refHeight || this.offscreenCanvas.height;

        this._setScale(Math.min(containerW / refW, containerH / refH) * 0.95);
        this.panX = 0;
        this.panY = 0;

        this.requestRender();
    }

    resize(w, h) {
        if (this.offscreenCanvas.width > 0) {
            this.requestRender();
        }
    }
}

window.DisplayCanvas = DisplayCanvas;