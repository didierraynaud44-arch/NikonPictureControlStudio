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
                    this.setZoomScale(percent / 100);
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

        const safeScale = Math.min(Math.max(this.minScale, targetScale), this.maxScale);

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
     * zoom dépasse ZOOM_FULLRES_THRESHOLD (flag this._fullResRequested, remis à
     * zéro uniquement pour une NOUVELLE photo, voir draw()) — pas de rechargement
     * en boucle pendant qu'on tourne la molette au-dessus du seuil.
     */
    _maybeRequestFullRes() {
        if (this.scale <= this.ZOOM_FULLRES_THRESHOLD) return;
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
        const percent = Math.round((this.scale || 1) * 100);
        if (this.zoomSlider) this.zoomSlider.value = percent;
        if (this.zoomText) this.zoomText.textContent = `${percent}%`;
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