/*=========================================================
    Nikon Picture Control Studio - Image Processor (Fix Overlay)
=========================================================*/

// 🔹 Seuil de détection "vrai glissement" (voir ImageProcessor.notifySliderInput()) :
// deux événements "input" séparés de moins de ce délai trahissent un glissement
// continu de souris. Un simple clic ne produit qu'un seul "input" et ne peut
// donc jamais atteindre ce seuil.
const SLIDER_DRAG_DETECT_MS = 60;

// 🔹 Source unique des valeurs par défaut Simulation Pellicule — utilisée par
// le constructeur, setFilmSettings() (rechargement d'une photo) ET
// applyPreset() (système de préréglages, voir presetsPanel.js), pour ne
// jamais avoir trois copies de ce même objet à maintenir en parallèle.
const DEFAULT_FILM_SETTINGS = Object.freeze({
    haldClutPath: null,
    haldClutIntensity: 100
});

class ImageProcessor {

    constructor(canvasId) {
        this.buffer = new ImageBuffer();
        this.originalRawBuffer = null;
        this.previewBuffer = null;

        // 🔹 Cache mémoire des décodages pleine résolution (export/impression),
        // pour éviter de redécoder un RAW déjà décodé pendant la session.
        this.fullResCache = new Map();
        this.fullResLoadedPath = null;
        this.loadedImage = null;
        this.currentOrientation = 1;
        this.currentLensInfo = null;

        // 🔹 Correction d'objectif (LensDatabaseParser + LensCorrectionFilter) :
        // le profil (distorsion/vignettage/TCA déjà interpolés pour la focale/
        // ouverture actuelles) est résolu de façon ASYNCHRONE (parse XML), donc
        // ne peut pas l'être depuis _buildRenderSettings() qui doit rester
        // synchrone (appelée à chaque frame). Résolu en amont, mis en cache ici,
        // re-render() automatique une fois prêt — même principe que le décodage
        // des cartes d'opacité IA (voir MaskEngine.computeAiAlpha).
        this.lensProfile = null;
        this._lensProfileKey = null;

        // 🔹 Chemin de la photo actuellement affichée dans le Studio (mis à jour par
        // l'appelant, voir app.js/loadImageInStudio) et flag indiquant si l'affichage
        // doit utiliser this.originalRawBuffer en pleine résolution plutôt que
        // this.previewBuffer (voir ensureFullResolutionLoaded, zoom > seuil).
        this.currentFilePath = null;
        this.useFullResForDisplay = false;

        // 🔹 Glissement de curseur en cours (Picture Control/Simulation Pellicule,
        // voir startSliderDrag()/endSliderDrag() ci-dessous) : force temporairement
        // render() à utiliser this.previewBuffer même si zoomé au-delà du seuil
        // pleine résolution — un pipeline complet (mélangeur N&B + Hald-CLUT) sur
        // un buffer 24 Mpx peut être coûteux, gelant l'interface à chaque tick de
        // glissement. Ne modifie JAMAIS useFullResForDisplay lui-même : simple
        // court-circuit de la source utilisée pour CE rendu précis, voir render().
        //
        // isDraggingSlider ne passe PAS à true dès le mousedown : un simple clic
        // ponctuel (un seul "input", sans glissement) NE DOIT PAS basculer vers
        // l'aperçu réduit — ça produirait un flash dégradation-puis-netteté
        // visible à chaque clic. Seul un 2e "input" rapproché (voir
        // notifySliderInput()/SLIDER_DRAG_DETECT_MS) prouve un vrai glissement
        // et déclenche le court-circuit.
        this.isDraggingSlider = false;
        this._lastSliderInputTime = null;

        this.display = new DisplayCanvas(canvasId);
        this.display.onRequestFullRes = async () => {
            if (!this.currentFilePath) return;
            await this.ensureFullResolutionLoaded(this.currentFilePath);
            // 🔹 render() protège maintenant LUI-MÊME (indicateur "Traitement en
            // cours..." + repaint forcé avant le calcul lourd) TOUT rendu qui
            // basculerait sur la pleine résolution avec Monochrome/Simulation
            // Pellicule actifs — pas seulement celui-ci — voir render() ci-dessous.
            // "await" indispensable ici : sans lui, la Promise retournée par
            // render() (jamais "réglé" tant que le calcul lourd éventuel ne s'est
            // pas terminé) ne serait pas attendue par le .finally() de
            // _maybeRequestFullRes() dans DisplayCanvas.js, qui masquerait alors
            // son propre indicateur ("Chargement pleine résolution...") AVANT que
            // le calcul lourd n'ait même commencé.
            await this.render();
        };

        this.overlayCanvas = document.getElementById("maskOverlayCanvas");
        this.overlayCtx = this.overlayCanvas ? this.overlayCanvas.getContext("2d") : null;

        // 🔹 Aperçu d'écrêtage façon Lightroom (Alt+glisser sur Point noir/Point
        // blanc, voir pictureControlPanel.js) : "blackPoint"/"whitePoint" pendant
        // qu'un aperçu est affiché sur overlayCanvas (voir showClippingPreview),
        // sinon null. Sert à savoir, dans hideClippingPreview(), s'il y a
        // effectivement quelque chose à effacer + un render() de rattrapage à
        // déclencher (sinon no-op silencieux, appelable sans condition).
        this._clippingPreviewField = null;
        this._clippingPreviewCanvas = null; // canvas hors-écran réutilisé (bitmap natif avant mise à l'échelle)

        this.transform = { rotation: 0, flipH: false, flipV: false };

        // 🔹 Recadrage + Niveau : cropSettings = { enabled, ratioId, rectX, rectY,
        // rectWidth, rectHeight } normalisés RELATIFS À L'IMAGE TOURNÉE (voir
        // _bakeTransform/applyCrop), persistés par photo. cropPanelActive n'est
        // vrai QUE pendant que le panneau Recadrage est ouvert (mis par
        // cropPanel.js) : c'est ce qui bascule render() en mode "rotation
        // gravée dans les pixels + cosmétique DisplayCanvas supprimée" (voir
        // render()) — le reste de l'app (édition masques/retouches) continue
        // d'utiliser la rotation cosmétique existante, inchangée.
        this.cropPanelActive = false;
        this.cropSettings = null;

        // 🔹 Correction de perspective : perspectiveSettings = { enabled, corners:
        // [4 points {x,y} normalisés, ordre [tl,tr,bl,br] ] }, s'applique en
        // continu dans le pipeline dès que enabled (comme un réglage Picture
        // Control), indépendamment de perspectivePanelActive — qui ne pilote
        // que l'affichage/l'interactivité des 4 poignées (voir
        // PerspectiveCanvasController.js et _drawPerspectiveOverlay).
        this.perspectivePanelActive = false;
        this.perspectiveSettings = null;
        this.perspectiveController = null;
        this.pictureControl = null;
        this.pipeline = new RenderPipeline();

        this.enableMasks = true;
        this.maskController = null;
        this.showMaskOverlay = true;

        // 🔹 Recadrage + Niveau : référence au contrôleur souris (voir
        // CropCanvasController.js), même rôle que maskController/retouchController.
        this.cropController = null;

        // 🔹 Retouche (tampon de duplication) : appliquée une fois, en amont du
        // pipeline. Cache par clé de résolution ("preview"/"fullRes"), invalidé
        // automatiquement si le buffer source change (nouvelle photo) ou si la
        // liste de RetouchManager change (RetouchManager.getVersion()).
        this.enableRetouches = true;
        this.retouchController = null;
        this._retouchCache = {};

        // 🔹 Débruitage neuronal (NAFNet, voir NeuralDenoiseEngine.js) : PAS un
        // filtre du pipeline (trop lent pour tourner à chaque frame) — un buffer
        // "cuit" une fois via applyNeuralDenoise(), au même niveau que les
        // retouches (avant Picture Control), réutilisé par render()/export tant
        // qu'il correspond encore au buffer source actuel et à la version des
        // retouches au moment du calcul (voir _resolveNeuralDenoiseBuffer).
        this.neuralDenoiseApplied = false;
        this.neuralDenoisePending = false; // appliqué lors d'une session précédente, à réappliquer explicitement
        this._neuralDenoiseBuffer = null;
        this._neuralDenoiseSourceRef = null;
        this._neuralDenoiseRetouchVersion = null;

        // 🔹 NOUVEAU : Histogramme
        this.histogramMode = "luminance"; // "luminance" | "rgb"
        this._lastImageDataForHistogram = null;

        // 🔹 Simulation Pellicule (Hald-CLUT) : réglages séparés de
        // this.pictureControl (et non fusionnés dedans), car readState() du
        // panneau Picture Control reconstruit un objet ne contenant QUE les champs
        // Picture Control connus à chaque changement de curseur — les stocker dans
        // pictureControl les ferait donc écraser au premier réglage PC modifié.
        // Même principe que RetouchManager pour les retouches. Les pixels bruts du
        // Hald-CLUT chargé (haldClutState) ne sont eux jamais persistés : seul le
        // chemin (filmSettings.haldClutPath) l'est, et le LUT est rechargé depuis
        // le disque via setFilmSettings() à la réouverture de la photo.
        this.filmSettings = { ...DEFAULT_FILM_SETTINGS };
        this.haldClutState = null; // { path, imageData, side }

        // 🔹 Correction d'objectif (distorsion/TCA/vignettage) : TOUJOURS en
        // tout premier — c'est une correction GÉOMÉTRIQUE qui doit précéder tout
        // filtre basé sur le voisinage des pixels (Netteté, Clarté, Débruitage,
        // etc.), sans quoi ceux-ci opéreraient sur une image encore déformée.
        if (typeof LensCorrectionFilter !== "undefined") this.pipeline.add(new LensCorrectionFilter());

        if (typeof WhiteBalanceFilter !== "undefined") this.pipeline.add(new WhiteBalanceFilter());
        if (typeof SharpenFilter !== "undefined") this.pipeline.add(new SharpenFilter());
        if (typeof MidRangeSharpenFilter !== "undefined") this.pipeline.add(new MidRangeSharpenFilter());
        if (typeof ClarityFilter !== "undefined") this.pipeline.add(new ClarityFilter());
        if (typeof ExposureFilter !== "undefined") this.pipeline.add(new ExposureFilter());
        if (typeof BlackWhitePointFilter !== "undefined") this.pipeline.add(new BlackWhitePointFilter());
        if (typeof ToneCurveFilter !== "undefined") this.pipeline.add(new ToneCurveFilter());
        if (typeof ContrastFilter !== "undefined") this.pipeline.add(new ContrastFilter());
        if (typeof BrightnessFilter !== "undefined") this.pipeline.add(new BrightnessFilter());
        if (typeof HighlightsFilter !== "undefined") this.pipeline.add(new HighlightsFilter());
        if (typeof ShadowsFilter !== "undefined") this.pipeline.add(new ShadowsFilter());
        if (typeof SaturationFilter !== "undefined") this.pipeline.add(new SaturationFilter());
        if (typeof ColorBlenderFilter !== "undefined") this.pipeline.add(new ColorBlenderFilter());
        if (typeof ColorGradingFilter !== "undefined") this.pipeline.add(new ColorGradingFilter());
        if (typeof MonochromeFilter !== "undefined") this.pipeline.add(new MonochromeFilter());

        // 🔹 Mélangeur N&B 8 canaux : réglage général comme les autres filtres
        // ci-dessus, lu directement sur this.pictureControl (monoMixerEnabled +
        // les 8 canaux, voir pictureControlPanel.js) — plus un module à part.
        if (typeof MonochromeMixerFilter !== "undefined") this.pipeline.add(new MonochromeMixerFilter());

        if (typeof DehazeFilter !== "undefined") this.pipeline.add(new DehazeFilter());
        if (typeof VibranceFilter !== "undefined") this.pipeline.add(new VibranceFilter());
        if (typeof SCurveFilter !== "undefined") this.pipeline.add(new SCurveFilter());
        if (typeof VignetteFilter !== "undefined") this.pipeline.add(new VignetteFilter());
        if (typeof DenoiseFilter !== "undefined") this.pipeline.add(new DenoiseFilter());

        // 🔹 Simulation Pellicule : toute fin du pipeline, après Picture Control/
        // masques.
        if (typeof HaldClutFilter !== "undefined") this.pipeline.add(new HaldClutFilter());
    }

    /**
     * Fusionne pictureControl et filmSettings en un seul objet de réglages pour
     * le pipeline, en y injectant les pixels du Hald-CLUT actuellement chargé en
     * mémoire (jamais persistés, voir le commentaire du constructeur).
     * @private
     */
    _buildRenderSettings() {
        const settings = { ...(this.pictureControl || {}), ...(this.filmSettings || {}) };
        if (this.haldClutState) {
            settings.haldClutData = this.haldClutState.imageData;
            settings.haldClutSide = this.haldClutState.side;
        }

        // 🔹 Correction d'objectif : injecte le profil déjà résolu (ou null tant
        // qu'il ne l'est pas encore / qu'aucun profil ne correspond) — voir
        // _refreshLensProfile, qui déclenche la résolution async et redemande
        // un render() une fois prête.
        if (settings.lensCorrection) {
            this._refreshLensProfile();
            settings.lensProfile = this.lensProfile;
        }

        return settings;
    }

    /**
     * Résout (de façon async, fire-and-forget) le profil Lensfun pour
     * l'objectif/focale/ouverture actuels (this.currentLensInfo), le met en
     * cache dans this.lensProfile, et redemande un render() une fois prêt.
     * No-op si l'objectif/focale n'a pas changé depuis la dernière résolution
     * (évite de re-parser à chaque frame pendant qu'on bouge un curseur).
     * @private
     */
    _refreshLensProfile() {
        if (typeof LensDatabaseParser === "undefined") return;
        const info = this.currentLensInfo;
        if (!info || !info.model) {
            this.lensProfile = null;
            this._lensProfileKey = null;
            return;
        }

        const key = `${info.model}|${info.focalLength}|${info.aperture}|${info.make}`;
        if (key === this._lensProfileKey) return; // déjà résolu (ou en cours) pour cette combinaison

        this._lensProfileKey = key;
        LensDatabaseParser.findLensProfile(info.model, info.focalLength, info.aperture, info.make)
            .then((profile) => {
                if (this._lensProfileKey !== key) return; // objectif/focale a changé entre-temps
                this.lensProfile = profile;
                if (this.originalRawBuffer) this.render();
                if (typeof this.onLensProfileResolved === "function") this.onLensProfileResolved(profile);
            })
            .catch((err) => {
                console.error("❌ Erreur résolution profil objectif :", err);
            });
    }

    /**
     * Réglages Simulation Pellicule actuellement actifs.
     */
    getFilmSettings() {
        return this.filmSettings;
    }

    /**
     * Remplace tous les réglages Simulation Pellicule (rechargement d'une photo).
     * Recharge automatiquement le Hald-CLUT depuis son chemin si celui-ci diffère
     * du LUT actuellement en mémoire (fire-and-forget : re-rendu une fois chargé).
     */
    setFilmSettings(settings) {
        this.filmSettings = { ...DEFAULT_FILM_SETTINGS, ...(settings || {}) };

        const newPath = this.filmSettings.haldClutPath || null;
        const currentPath = this.haldClutState ? this.haldClutState.path : null;
        if (newPath !== currentPath) {
            if (newPath) {
                this.loadHaldClutFile(newPath).catch(err => {
                    console.warn("⚠️ Impossible de recharger le Hald-CLUT :", newPath, err);
                });
            } else {
                this.haldClutState = null;
            }
        }

        if (this.originalRawBuffer) this.render();
    }

    /**
     * Modifie un seul réglage Simulation Pellicule (curseur en direct dans filmPanel.js).
     * Ne déclenche PAS de rendu ici : le pipeline peut être lourd et synchrone
     * (Hald-CLUT), donc filmPanel.js débounce l'appel à render() séparément pour
     * ne pas bloquer le thread principal pendant le glissement du curseur.
     */
    updateFilmSetting(field, value) {
        if (!this.filmSettings) this.filmSettings = {};
        this.filmSettings[field] = value;
    }

    /**
     * Charge un fichier Hald-CLUT (PNG) depuis le disque et le décode en ImageData
     * via un canvas temporaire (même approche que le reste de l'app pour charger
     * une image locale). Seul le CHEMIN est conservé dans filmSettings pour la
     * persistance par photo — les pixels restent en mémoire (this.haldClutState).
     * @param {string} filePath
     * @param {{skipRender?: boolean}} [options] - skipRender: true pour un appelant
     *        qui va lui-même déclencher UN SEUL render() après plusieurs changements
     *        d'état (ex. applyPreset() ci-dessous), pour éviter un rendu intermédiaire
     *        avec un état encore incomplet.
     */
    async loadHaldClutFile(filePath, { skipRender = false } = {}) {
        if (!filePath) return null;

        const imageData = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                try {
                    resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error(`Impossible de charger l'image : ${filePath}`));
            const formatted = filePath.toString().replace(/\\/g, "/");
            img.src = formatted.startsWith("/") ? `file://${formatted}` : `file:///${formatted}`;
        });

        this.haldClutState = { path: filePath, imageData, side: imageData.width };

        if (!this.filmSettings) this.filmSettings = {};
        this.filmSettings.haldClutPath = filePath;
        if (this.filmSettings.haldClutIntensity === undefined) this.filmSettings.haldClutIntensity = 100;

        if (!skipRender && this.originalRawBuffer) this.render();
        return this.haldClutState;
    }

    /**
     * Applique un préréglage complet (système "Presets", voir presetsPanel.js) :
     * Picture Control + module Monochrome + Simulation Pellicule en une seule
     * "recette", sur la photo actuellement affichée dans le Studio. Studio
     * uniquement — le Gestionnaire de Profils utilise sa propre instance
     * ImageProcessor (profileImageProcessor), jamais touchée ici puisque
     * cette méthode n'agit que sur l'instance sur laquelle elle est appelée.
     *
     * @param {object} presetData - Forme exacte produite par "Enregistrer le
     *   préréglage actuel..." (voir presetsPanel.js) : { name, category,
     *   pictureControl, film }. Le mélangeur N&B (monoMixerEnabled + 8 canaux)
     *   est un réglage Picture Control normal, déjà inclus dans pictureControl.
     */
    async applyPreset(presetData) {
        if (!presetData) return;

        if (presetData.pictureControl) {
            this.pictureControl = this.cleanPictureControl(presetData.pictureControl);
        }

        if (presetData.film) {
            this.filmSettings = { ...DEFAULT_FILM_SETTINGS, ...presetData.film };
            const haldPath = this.filmSettings.haldClutPath || null;
            if (haldPath) {
                try {
                    await this.loadHaldClutFile(haldPath, { skipRender: true });
                } catch (err) {
                    console.warn("⚠️ Impossible de charger le Hald-CLUT du préréglage :", haldPath, err);
                    this.haldClutState = null;
                    this.filmSettings.haldClutPath = null;
                }
            } else {
                this.haldClutState = null;
            }
        }

        if (this.originalRawBuffer) this.render();
    }

    /**
     * Retire le Hald-CLUT actuellement chargé (mémoire + chemin persisté).
     */
    clearHaldClut() {
        this.haldClutState = null;
        if (this.filmSettings) this.filmSettings.haldClutPath = null;
        if (this.originalRawBuffer) this.render();
    }

    setTransform({ rotation, flipH, flipV }) {
        if (rotation !== undefined) this.transform.rotation = rotation;
        if (flipH !== undefined) this.transform.flipH = flipH;
        if (flipV !== undefined) this.transform.flipV = flipV;
        this.render();
    }

    resetTransform() {
        this.transform = { rotation: 0, flipH: false, flipV: false };
    }

    createRotatedCanvas(img, orientation = 1, targetWidth = null) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        let srcW = img.width;
        let srcH = img.height;

        if (targetWidth && srcW > targetWidth) {
            srcH = Math.round((targetWidth / srcW) * srcH);
            srcW = targetWidth;
        }

        if (orientation === 6 || orientation === 8) {
            canvas.width = srcH;
            canvas.height = srcW;
        } else {
            canvas.width = srcW;
            canvas.height = srcH;
        }

        ctx.save();
        switch (orientation) {
            case 3:
                ctx.translate(canvas.width, canvas.height);
                ctx.rotate(Math.PI);
                break;
            case 6:
                ctx.translate(canvas.width, 0);
                ctx.rotate(Math.PI / 2);
                break;
            case 8:
                ctx.translate(0, canvas.height);
                ctx.rotate(-Math.PI / 2);
                break;
        }
        ctx.drawImage(img, 0, 0, srcW, srcH);
        ctx.restore();
        return canvas;
    }

    load(imageSrc, orientation = 1, metadata = {}) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";

            img.onload = () => {
                this.loadedImage = img;
                this.currentOrientation = Number(orientation) || 1;
                this.currentLensInfo = {
                    model: metadata.lens || "Generic",
                    focalLength: metadata.focalLength || 0,
                    aperture: metadata.aperture || 0,
                    make: metadata.make || null
                };

                this.resetTransform();

                const fullCanvas = this.createRotatedCanvas(img, this.currentOrientation);
                const fullCtx = fullCanvas.getContext("2d");
                this.originalRawBuffer = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);

                // Ce buffer est la vignette basse résolution : un éventuel chargement
                // pleine résolution précédent pour ce fichier n'est plus le buffer actif.
                this.fullResLoadedPath = null;
                this.useFullResForDisplay = false;
                this.currentFilePath = null;

                const previewCanvas = this.createRotatedCanvas(img, this.currentOrientation, 1600);
                const previewCtx = previewCanvas.getContext("2d");
                this.previewBuffer = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

                if (this.overlayCanvas) {
                    this.overlayCanvas.width = previewCanvas.width;
                    this.overlayCanvas.height = previewCanvas.height;
                }

                // 🔹 Résolution native réelle (EXIF, voir main.js "read-file-direct" /
                // app.js) — AVANT render() pour que le premier draw() de cette photo
                // (donc le premier calcul du pourcentage de zoom affiché) l'utilise
                // déjà, sans "flash" de la mauvaise valeur. Toujours réassigné (même
                // si absent pour CETTE photo) pour ne pas laisser traîner la valeur
                // de la photo PRÉCÉDENTE — voir DisplayCanvas.setTrueImageResolution().
                if (this.display && typeof this.display.setTrueImageResolution === "function") {
                    this.display.setTrueImageResolution(metadata.trueWidth, metadata.trueHeight);
                }

                this.render();
                resolve(this.originalRawBuffer);
            };

            img.onerror = (err) => reject(err);
            img.src = imageSrc;
        });
    }

    cleanPictureControl(pcData) {
        if (!pcData || typeof pcData !== "object") return {};
        const clean = { ...pcData };
        const parseVal = (val, defaultVal = 0) => {
            if (typeof val === "number" && !isNaN(val)) return val === -128 ? 0 : val;
            if (val === "Normal" || val === null || val === undefined) return defaultVal;
            const p = parseFloat(val);
            return isNaN(p) || p === -128 ? defaultVal : p;
        };

        clean.wbTemperature = parseVal(pcData.wbTemperature, 0);
        clean.wbTint        = parseVal(pcData.wbTint, 0);
        clean.sharpening = parseVal(pcData.sharpening ?? pcData.sharpning ?? pcData.sharpness, 0);
        clean.midRangeSharpening = parseVal(pcData.midRangeSharpening ?? pcData.midRangeSharpning, 0);
        clean.clarity            = parseVal(clean.clarity, 0);
        clean.contrast           = parseVal(clean.contrast, 0);
        clean.brightness         = parseVal(clean.brightness, 0);
        clean.saturation         = parseVal(clean.saturation, 0);
        clean.hue                = parseVal(clean.hue, 0);
        clean.highlights = parseVal(clean.highlights, 0);
        clean.shadows    = parseVal(clean.shadows, 0);
        clean.dehaze     = parseVal(clean.dehaze, 0);
        clean.vibrance   = parseVal(clean.vibrance, 0);
        clean.vignette   = parseVal(clean.vignette, 0);
        clean.denoise    = parseVal(clean.denoise, 0);
        clean.exposure   = parseVal(clean.exposure, 0);
        clean.blackPoint = parseVal(clean.blackPoint, 0);
        clean.whitePoint = clean.whitePoint === undefined || clean.whitePoint === null ? 255 : parseVal(clean.whitePoint, 255);
        clean.isMonochrome = clean.isMonochrome === true || clean.baseProfile === "MONOCHROME";
        clean.monoFilter   = clean.monoFilter || "None";
        clean.monoToning   = clean.monoToning || "None";

        if (clean.isMonochrome) clean.saturation = -100;
        return clean;
    }

    setPictureControl(pcData) {
        this.pictureControl = this.cleanPictureControl(pcData);
        if (this.originalRawBuffer) this.render();
    }

    /**
     * 🔹 Début d'un GESTE de curseur (mousedown, voir pictureControlPanel.js/
     * filmPanel.js) : arme seulement la détection de
     * glissement (voir notifySliderInput()) — ne bascule PAS isDraggingSlider
     * ici. Un simple clic (mousedown + un seul "input" + mouseup) doit rester
     * en pleine résolution, sans flash ; seul un vrai glissement (2e "input"
     * rapproché) le fera basculer.
     */
    startSliderDrag() {
        this._lastSliderInputTime = null;
    }

    /**
     * 🔹 À appeler depuis CHAQUE écouteur "input" d'un curseur concerné (voir
     * startSliderDrag() ci-dessus). Ne bascule isDraggingSlider que si CE
     * "input" arrive moins de SLIDER_DRAG_DETECT_MS après le précédent de ce
     * même geste — signe d'un glissement continu, jamais atteignable par un
     * simple clic ponctuel (un seul "input").
     */
    notifySliderInput() {
        const now = performance.now();
        if (this._lastSliderInputTime !== null && (now - this._lastSliderInputTime) < SLIDER_DRAG_DETECT_MS) {
            this.isDraggingSlider = true;
        }
        this._lastSliderInputTime = now;
    }

    /**
     * 🔹 Fin d'un glissement de curseur (mouseup GLOBAL sur window — capte un
     * relâchement même si la souris a glissé hors du curseur, voir app.js) :
     * un seul rendu final en pleine résolution affiche le résultat net.
     * Idempotent/sans condition : no-op silencieux si aucun glissement n'était
     * en cours (appelable sans savoir si un curseur était réellement tenu).
     */
    endSliderDrag() {
        this._lastSliderInputTime = null;
        if (!this.isDraggingSlider) return;
        this.isDraggingSlider = false;
        if (this.originalRawBuffer) this.render();
    }

    /**
     * 🔹 Le CALCUL à l'intérieur de render()/_renderSync() reste synchrone et
     * peut, sur un très gros fichier (Hald-CLUT actif, voir
     * _isHeavyRenderExpected()), prendre assez de temps pour bloquer le thread
     * principal un instant perceptible — pendant ce temps, AUCUN clic (case à
     * cocher, bouton) ne peut être traité avant qu'il ne se libère. Plusieurs
     * clics lancés "à l'aveugle" pendant ce blocage (l'utilisateur croit l'app
     * plantée et re-clique) s'empilent alors en file d'attente native du
     * navigateur et se déclenchent un par un dès la fin du rendu précédent —
     * chacun relançant SON PROPRE calcul à la suite, cumulant les gels au lieu
     * d'un seul (render() affiche "Traitement en cours..." avant CHACUN de ces
     * calculs, voir render() ci-dessous — mais ça n'empêche pas la cascade).
     *
     * scheduleRender() casse cette cascade : au lieu d'appeler render()
     * directement depuis un gestionnaire de case à cocher/bouton, on planifie un
     * appel différé, ANNULANT tout appel encore en attente — seul le DERNIER état
     * réglé avant l'expiration du délai déclenche un render() (voir
     * pictureControlPanel.js, case "Activer le mélangeur"). N clics stackés
     * pendant qu'un rendu tourne encore se traiteront bien un par un une fois
     * celui-ci terminé (le thread ne peut pas faire autrement), mais si leurs
     * gestionnaires respectifs ne font QUE mettre à jour l'état + replanifier
     * (rapide), seul le tout dernier survit au délai et déclenche un unique
     * render() final — pas une cascade.
     */
    scheduleRender(delayMs = 150) {
        if (this._scheduledRenderTimer) clearTimeout(this._scheduledRenderTimer);
        this._scheduledRenderTimer = setTimeout(() => {
            this._scheduledRenderTimer = null;
            this.render();
        }, delayMs);
    }

    /**
     * 🔹 Vrai si le PROCHAIN render() est susceptible d'être coûteux : Hald-CLUT
     * de la Simulation Pellicule actif — seul filtre restant avec un coût par
     * pixel notable sur un gros fichier (interpolation trilinéaire dans le cube
     * couleur), depuis le retrait du module Monochrome dédié (Dodge & Burn,
     * Lumière tamisée), du Grain et de la Halation (voir simplification du
     * pipeline). Le mélangeur N&B lui-même n'est PAS considéré lourd : filtre
     * par pixel simple, comparable à Saturation/Vibrance. Sert à décider
     * d'afficher "Traitement en cours..." (voir render() ci-dessus) — pas un
     * calcul exact du coût réel, une heuristique suffisante pour ce signal
     * purement visuel.
     */
    _isHeavyRenderExpected() {
        const film = this.filmSettings || {};
        return !!film.haldClutPath && (film.haldClutIntensity ?? 0) > 0;
    }

    updateFilter(filterType, value) {
        if (!this.pictureControl) this.pictureControl = {};
        if (filterType === "monochrome") {
            this.pictureControl.isMonochrome = Boolean(value);
            this.pictureControl.saturation = value ? -100 : 0;
        } else if (typeof value === "boolean") {
            this.pictureControl[filterType] = value;
        } else {
            const parsed = parseFloat(value);
            this.pictureControl[filterType] = isNaN(parsed) ? value : parsed;
        }
        if (this.originalRawBuffer) this.render();
    }

    /**
     * Applique toutes les opérations de RetouchManager (tampon de duplication)
     * sur une copie de sourceBuffer, AVANT le pipeline Picture Control, pour
     * que les réglages globaux/masques s'appliquent ensuite normalement
     * par-dessus la zone corrigée. Résultat mis en cache par cacheKey tant
     * que sourceBuffer et RetouchManager.getVersion() n'ont pas changé.
     *
     * 🔹 Gomme derrière this.enableRetouches (même principe que this.enableMasks
     * pour MasksManager) : RetouchManager est un état GLOBAL, partagé par
     * TOUTES les instances ImageProcessor — sans ce verrou, une retouche peinte
     * sur la photo du Studio s'appliquerait aussi au rendu du Gestionnaire de
     * Profils, qui doit rester strictement indépendant du Studio.
     */
    _applyRetouches(sourceBuffer, cacheKey) {
        if (!this.enableRetouches) return sourceBuffer;
        if (!sourceBuffer) return sourceBuffer;
        if (typeof RetouchManager === "undefined" || typeof HealEngine === "undefined" || typeof MaskEngine === "undefined") {
            return sourceBuffer;
        }

        const ops = RetouchManager.getRetouches();
        if (!ops.length) return sourceBuffer;

        const version = RetouchManager.getVersion();
        const cached = this._retouchCache[cacheKey];
        if (cached && cached.sourceBuffer === sourceBuffer && cached.version === version) {
            return cached.result;
        }

        let working = new ImageData(
            new Uint8ClampedArray(sourceBuffer.data),
            sourceBuffer.width,
            sourceBuffer.height
        );

        for (const op of ops) {
            const alpha = MaskEngine.computeBrushAlpha(working.width, working.height, op.destGeometry);
            const dx = op.sourceOffset.dx * working.width;
            const dy = op.sourceOffset.dy * working.height;

            try {
                working = HealEngine.poissonBlend(working, alpha, dx, dy);
            } catch (err) {
                console.error("❌ Erreur fusion Poisson, repli sur copie simple :", err);
                try {
                    working = HealEngine.cloneCopy(working, alpha, dx, dy);
                } catch (err2) {
                    console.error("❌ Erreur copie simple de repli :", err2);
                }
            }
        }

        this._retouchCache[cacheKey] = { sourceBuffer, version, result: working };
        return working;
    }

    /**
     * Buffer à utiliser pour le pipeline : le buffer débruité par IA (voir
     * applyNeuralDenoise) si un résultat valide existe pour CE buffer source
     * précis (référence identique, donc invalidé automatiquement dès que la
     * photo ou la résolution change) et que les retouches n'ont pas changé
     * depuis son calcul — sinon, sourceBuffer tel quel.
     * @private
     */
    _resolveNeuralDenoiseBuffer(sourceBuffer) {
        if (this.neuralDenoiseApplied
            && this._neuralDenoiseBuffer
            && this._neuralDenoiseSourceRef === sourceBuffer
            && this._neuralDenoiseRetouchVersion === (typeof RetouchManager !== "undefined" ? RetouchManager.getVersion() : null)) {
            return this._neuralDenoiseBuffer;
        }
        return sourceBuffer;
    }

    /**
     * Lance le débruitage neuronal (NAFNet, voir NeuralDenoiseEngine.js) sur la
     * photo actuellement affichée, TOUJOURS en pleine résolution (jamais sur
     * l'aperçu réduit — sinon le résultat visible ne correspondrait pas à
     * l'export). Réutilise le mécanisme de bascule pleine résolution déjà en
     * place pour le zoom (ensureFullResolutionLoaded) : le Studio bascule donc
     * automatiquement en pleine résolution pendant/après le traitement, comme
     * un zoom au-delà du seuil.
     * @param {(done:number, total:number) => void} [onProgress]
     * @param {{cancelled:boolean}} [signal]
     * @returns {Promise<boolean>} true si le débruitage a été appliqué avec succès
     */
    async applyNeuralDenoise(onProgress, signal) {
        if (typeof NeuralDenoiseEngine === "undefined") {
            console.error("❌ NeuralDenoiseEngine indisponible");
            return false;
        }
        if (!this.currentFilePath) {
            console.warn("⚠️ Aucune photo chargée pour le débruitage neuronal");
            return false;
        }

        await this.ensureFullResolutionLoaded(this.currentFilePath);
        if (!this.originalRawBuffer) {
            console.error("❌ Pas de buffer pleine résolution pour le débruitage neuronal");
            return false;
        }

        const source = this._applyRetouches(this.originalRawBuffer, "fullRes");

        try {
            const result = await NeuralDenoiseEngine.denoiseImage(source, { onProgress, signal });
            this._neuralDenoiseBuffer = result;
            this._neuralDenoiseSourceRef = source;
            this._neuralDenoiseRetouchVersion = typeof RetouchManager !== "undefined" ? RetouchManager.getVersion() : null;
            this.neuralDenoiseApplied = true;
            this.neuralDenoisePending = false;
            this.render();
            return true;
        } catch (err) {
            if (!err || !err.cancelled) {
                console.error("❌ Erreur débruitage neuronal :", err);
            }
            return false;
        }
    }

    /**
     * Retire le débruitage neuronal appliqué (revient au buffer normal, comme
     * annuler une retouche) — ne touche PAS neuralDenoisePending, géré séparément
     * par app.js au chargement d'une photo.
     */
    removeNeuralDenoise() {
        this.neuralDenoiseApplied = false;
        this._neuralDenoiseBuffer = null;
        this._neuralDenoiseSourceRef = null;
        this._neuralDenoiseRetouchVersion = null;
        this.render();
    }

    /**
     * Indique qu'un débruitage neuronal avait été appliqué lors d'une session
     * précédente pour cette photo (chargé depuis la base, voir app.js) — ne
     * recalcule PAS automatiquement (opération lente), affiche juste une
     * proposition de réapplication dans le panneau (voir neuralDenoisePanel.js).
     */
    setNeuralDenoisePending(flag) {
        this.neuralDenoisePending = !!flag;
    }

    /**
     * 🔹 Point d'entrée UNIQUE (async, mais tous les appelants existants
     * l'appellent sans "await" — voir plus bas pourquoi c'est sans risque pour
     * eux). Détecte AVANT de lancer le pipeline si ce rendu précis va être lourd
     * ET tourner sur la pleine résolution (Monochrome/Simulation Pellicule
     * actifs + déjà zoomé au-delà du seuil, voir _isHeavyRenderExpected()) —
     * mesuré en conditions réelles jusqu'à plus d'une minute sur 24 Mpx (Dodge &
     * Burn + Monochrome). Protège TOUS les chemins qui peuvent déclencher ce
     * rendu précis (endSliderDrag() au relâchement, debounce 30ms de n'importe
     * quel curseur, cases à cocher...), pas seulement le zoom qui bascule vers
     * la pleine résolution — un seul garde-fou central au lieu d'en dupliquer un
     * dans chaque panneau.
     *
     * Rétrocompatible à 100% avec les ~25 appels existants "imageProcessor.
     * render()" (sans await) : tant que ce garde-fou ne se déclenche PAS (cas de
     * loin le plus fréquent — pas de Monochrome/Simulation Pellicule actifs, ou
     * pas encore zoomé en pleine résolution), aucun "await" n'est jamais
     * atteint, donc _renderSync() s'exécute de façon parfaitement synchrone
     * comme avant, dans le MÊME tick — le Promise retourné (ignoré par ces
     * appelants) est déjà résolu au moment où il est créé.
     */
    async render() {
        const fullResAvailable = !!this.currentFilePath
            && this.fullResLoadedPath === this.currentFilePath
            && !!this.originalRawBuffer;
        const usingFullRes = !this.isDraggingSlider && this.useFullResForDisplay && fullResAvailable;

        let indicatorShown = false;
        if (usingFullRes && this.display && this._isHeavyRenderExpected()) {
            indicatorShown = true;
            this.display.showProcessingIndicator("Traitement en cours...");
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }

        try {
            this._renderSync(usingFullRes, fullResAvailable);
        } finally {
            if (indicatorShown) this.display.hideProcessingIndicator();
        }
    }

    /**
     * 🔹 Corps synchrone du pipeline de rendu — inchangé depuis avant l'ajout du
     * garde-fou ci-dessus, juste extrait de render() pour recevoir usingFullRes/
     * fullResAvailable déjà calculés (pas question de les recalculer après le
     * "await" éventuel : ce sont des snapshots de l'intention au moment de
     * l'appel à render(), comme avant le découpage en deux méthodes).
     */
    _renderSync(usingFullRes, fullResAvailable) {
        const rawSourceBuffer = usingFullRes ? this.originalRawBuffer : (this.previewBuffer || this.originalRawBuffer);
        if (!rawSourceBuffer || !this.display) return;

        const sourceBuffer = this._applyRetouches(rawSourceBuffer, usingFullRes ? "fullRes" : "preview");
        const workingBuffer = this._resolveNeuralDenoiseBuffer(sourceBuffer);

        let currentImageData = new ImageData(
            new Uint8ClampedArray(workingBuffer.data),
            workingBuffer.width,
            workingBuffer.height
        );

        if (this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this._buildRenderSettings());
                if (result && result.data) currentImageData = result;
            } catch (err) {
                console.error("❌ Erreur pipeline :", err);
            }
        }

        if (this.enableMasks && typeof MaskEngine !== "undefined" && typeof MasksManager !== "undefined") {
            try {
                currentImageData = MaskEngine.applyAllMasks(currentImageData, MasksManager.getMasks(), this.pipeline);
            } catch (err) {
                console.error("❌ Erreur application des masques :", err);
            }
        }

        // 🔹 Correction de perspective : correction géométrique de finition,
        // APRÈS le rendu créatif (Picture Control/masques/Monochrome) car elle
        // dépend du contenu visuel final que l'utilisateur voit pour choisir
        // ses 4 points — AVANT le recadrage/la rotation gravée (voir plus bas).
        // S'applique dès que perspectiveSettings.enabled, indépendamment du
        // panneau ouvert ou non (comme un réglage Picture Control).
        if (this.perspectiveSettings && this.perspectiveSettings.enabled && typeof PerspectiveEngine !== "undefined") {
            try {
                currentImageData = PerspectiveEngine.applyPerspective(currentImageData, this.perspectiveSettings.corners);
            } catch (err) {
                console.error("❌ Erreur correction de perspective :", err);
            }
        }

        // 🔹 Panneau Recadrage actif : la rotation est gravée RÉELLEMENT dans les
        // pixels ici (voir _bakeTransform) plutôt que laissée cosmétique côté
        // DisplayCanvas — c'est ce qui permet à CropCanvasController de placer
        // son cadre/poignées en coordonnées simples (pan/zoom uniquement, comme
        // MaskCanvasController), l'image affichée étant déjà axis-aligned. On
        // n'appelle PAS applyCrop() ici : le cadre reste un survol/overlay
        // pendant l'édition (comme un masque), pas une découpe physique tant
        // que l'utilisateur n'a pas quitté le panneau — le recadrage réel
        // n'intervient qu'à l'export (voir exportFullResolution/exportProcessedTiff).
        // Partout ailleurs (masques/retouches en cours d'édition, etc.), la
        // rotation cosmétique de DisplayCanvas reste inchangée pour ne rien casser.
        let displayTransform = this.transform;
        if (this.cropPanelActive) {
            currentImageData = this._bakeTransform(currentImageData, this.transform);
            displayTransform = { rotation: 0, flipH: false, flipV: false };
        }

        if (typeof this.display.setTransform === "function") {
            this.display.setTransform(displayTransform);
        }

        // 🔹 preserveView basé sur fullResAvailable (PAS usingFullRes) : pendant un
        // glissement de curseur, ce rendu utilise previewBuffer (usingFullRes
        // false) alors que le zoom pleine résolution reste actif pour cette photo
        // — sans ça, DisplayCanvas.draw() traiterait ce changement de dimensions
        // de buffer comme une "nouvelle photo" et réinitialiserait le zoom/cadrage
        // en cours (voir DisplayCanvas.draw()/resetZoom()).
        this.display.draw(currentImageData, { preserveView: fullResAvailable });
        if (this.enableMasks) this.renderMaskOverlay();

        // 🔹 NOUVEAU : Histogramme mis à jour à chaque rendu (donc en temps réel
        // à chaque réglage), sur les MÊMES données que ce qui est affiché.
        try {
            this._lastImageDataForHistogram = currentImageData;
            this.updateHistogram(currentImageData);
        } catch (err) {
            console.error("❌ Erreur mise à jour histogramme :", err);
        }
    }

    /**
     * 🔹 NOUVEAU : Calcule et dessine l'histogramme (luminance ou RVB) à partir
     * des données d'image actuellement affichées (post pipeline + masques).
     */
    updateHistogram(imageData) {
        const canvas = document.getElementById("histogramCanvas");
        if (!canvas || !imageData || !imageData.data) return;
        const ctx = canvas.getContext("2d");
        const w = canvas.width, h = canvas.height;

        const data = imageData.data;
        const totalPixels = imageData.width * imageData.height;

        // Échantillonnage pour rester fluide même en glissant un curseur en direct
        const maxSamples = 250000;
        const pixelStep = Math.max(1, Math.floor(totalPixels / maxSamples));
        const byteStep = pixelStep * 4;

        const rBins = new Uint32Array(256);
        const gBins = new Uint32Array(256);
        const bBins = new Uint32Array(256);
        const lBins = new Uint32Array(256);

        for (let i = 0; i < data.length; i += byteStep) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            rBins[r]++;
            gBins[g]++;
            bBins[b]++;
            lBins[(0.299 * r + 0.587 * g + 0.114 * b) | 0]++;
        }

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, w, h);

        if (this.histogramMode === "rgb") {
            ctx.globalCompositeOperation = "lighter";
            this._drawHistogramChannel(ctx, rBins, w, h, "rgba(255,70,70,0.75)");
            this._drawHistogramChannel(ctx, gBins, w, h, "rgba(60,255,110,0.65)");
            this._drawHistogramChannel(ctx, bBins, w, h, "rgba(80,140,255,0.65)");
            ctx.globalCompositeOperation = "source-over";
        } else {
            this._drawHistogramChannel(ctx, lBins, w, h, "rgba(220,220,220,0.9)");
        }
    }

    /**
     * 🔹 NOUVEAU : Dessine une courbe/silhouette remplie pour un canal de l'histogramme.
     * @private
     */
    _drawHistogramChannel(ctx, bins, w, h, color) {
        let max = 1;
        for (let i = 0; i < 256; i++) if (bins[i] > max) max = bins[i];

        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < 256; i++) {
            const x = (i / 255) * w;
            // Compression sqrt pour que les pics n'écrasent pas le reste (comme la plupart des logiciels photo)
            const norm = Math.sqrt(bins[i] / max);
            const y = h - norm * h;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    }

    /**
     * 🔹 NOUVEAU : Bascule entre histogramme Luminance et RVB, sans recalculer le pipeline
     * (redessine juste à partir des dernières données déjà traitées).
     */
    toggleHistogramMode() {
        this.histogramMode = this.histogramMode === "rgb" ? "luminance" : "rgb";
        if (this._lastImageDataForHistogram) {
            this.updateHistogram(this._lastImageDataForHistogram);
        }
        return this.histogramMode;
    }

    /**
     * 🔹 Exporte l'image pure traitée (sans le fond ni le conteneur du DisplayCanvas)
     */
    getProcessedImageBlobUrl(quality = 0.95) {
        const rawSourceBuffer = this.previewBuffer || this.originalRawBuffer;
        if (!rawSourceBuffer) return null;

        const sourceBuffer = this._applyRetouches(rawSourceBuffer, "preview");

        let currentImageData = new ImageData(
            new Uint8ClampedArray(sourceBuffer.data),
            sourceBuffer.width,
            sourceBuffer.height
        );

        if (this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this._buildRenderSettings());
                if (result && result.data) currentImageData = result;
            } catch (err) {
                console.error("❌ Erreur pipeline export :", err);
            }
        }

        if (this.enableMasks && typeof MaskEngine !== "undefined" && typeof MasksManager !== "undefined") {
            try {
                currentImageData = MaskEngine.applyAllMasks(currentImageData, MasksManager.getMasks(), this.pipeline);
            } catch (err) {
                console.error("❌ Erreur masques export :", err);
            }
        }

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(currentImageData, 0, 0);

        return tempCanvas.toDataURL("image/jpeg", quality);
    }

    /**
     * 🔹 Charge la pleine résolution pour l'AFFICHAGE Studio (zoom au-delà du seuil,
     * voir DisplayCanvas.ZOOM_FULLRES_THRESHOLD / onRequestFullRes). Réutilise
     * EXACTEMENT le même cache par filePath que loadFullResolutionForExport()
     * (export/impression) : ne décode qu'une seule fois par photo pendant la
     * session, que ce soit le zoom, l'export ou l'impression qui déclenche le
     * premier chargement. Si déjà en cache, retourne immédiatement.
     * @param {string} filePath
     * @returns {Promise<ImageData|null>}
     */
    async ensureFullResolutionLoaded(filePath) {
        if (!filePath) return null;

        const imageData = await this.loadFullResolutionForExport(filePath);
        if (imageData) this.useFullResForDisplay = true;
        return imageData;
    }

    /**
     * 🔹 Charge le buffer PLEINE RÉSOLUTION (résolution capteur native pour un RAW,
     * résolution native du fichier pour une image standard) pour l'export/impression.
     * Résultat mis en cache par filePath pour éviter de redécoder plusieurs fois
     * la même photo pendant la session, et stocké dans this.originalRawBuffer
     * (qui remplace la version basse résolution utilisée pour l'aperçu Studio).
     * @param {string} filePath
     * @returns {Promise<ImageData|null>}
     */
    async loadFullResolutionForExport(filePath) {
        if (!filePath) return null;

        if (this.fullResCache.has(filePath)) {
            const cached = this.fullResCache.get(filePath);
            this.originalRawBuffer = cached;
            this.fullResLoadedPath = filePath;
            return cached;
        }

        if (!window.electronAPI || typeof window.electronAPI.getFullResolutionImage !== "function") {
            console.warn("⚠️ electronAPI.getFullResolutionImage indisponible");
            return null;
        }

        console.log(`⏳ Décodage pleine résolution en cours pour ${filePath}...`);
        const result = await window.electronAPI.getFullResolutionImage(filePath);

        if (!result || !result.success) {
            console.error("❌ Échec chargement pleine résolution :", result?.error);
            return null;
        }

        let imageData = null;

        if (result.isRaw) {
            if (typeof window.decodeRawFullResolution === "function") {
                const decoded = await window.decodeRawFullResolution(result.rawBytes);
                if (decoded) {
                    imageData = new ImageData(decoded.data, decoded.width, decoded.height);
                }
            }

            // Repli : le décodage pleine résolution a échoué sur ce fichier
            // particulier -> on retombe sur la vignette embarquée (decodeRAWImage),
            // déjà utilisée pour le chargement rapide dans le Studio. Cette vignette
            // n'est PAS pré-tournée (voir orientation EXIF/RAW, main.js) : orientation
            // appliquée ici comme pour l'aperçu (this.currentOrientation), sinon la
            // photo repartirait dans son orientation capteur brute une fois zoomée/
            // exportée/imprimée en pleine résolution malgré un aperçu correct.
            if (!imageData) {
                console.warn("⚠️ Décodage RAW pleine résolution indisponible, repli sur la vignette embarquée");
                const fallback = await window.electronAPI.readFileDirect(filePath);
                if (fallback && fallback.preview) {
                    imageData = await this._dataUrlToImageData(fallback.preview, fallback.orientation || 1);
                }
            }
        } else if (result.dataUrl) {
            imageData = await this._dataUrlToImageData(result.dataUrl, result.orientation || 1);
        }

        if (!imageData) return null;

        this.fullResCache.set(filePath, imageData);
        this.originalRawBuffer = imageData;
        this.fullResLoadedPath = filePath;
        return imageData;
    }

    /**
     * @private
     */
    _dataUrlToImageData(dataUrl, orientation = 1) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = this.createRotatedCanvas(img, orientation);
                const ctx = canvas.getContext("2d");
                resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    /**
     * 🔹 NOUVELLE MÉTHODE : Exporte en PLEINE RÉSOLUTION avec toutes les modifications
     * @param {string} filePath - Chemin du fichier source, pour charger le buffer pleine
     *        résolution s'il n'est pas déjà chargé (voir loadFullResolutionForExport)
     * @param {number} quality - Qualité JPEG (0.0 à 1.0)
     * @param {string} format - Format de sortie ("image/jpeg" ou "image/png")
     * @param {{enabled:boolean, color:string, widthPercent:number}} [frameOptions] - Encadrement
     *        optionnel (voir FrameUtils.js), appliqué en toute dernière étape. Absent/non fourni
     *        par défaut : n'affecte donc PAS exportProcessedTiff ("Ouvrir avec"), qui n'en passe pas.
     * @returns {Promise<string|null>} - DataURL de l'image exportée
     */
    async exportFullResolution(filePath, quality = 0.95, format = "image/jpeg", frameOptions = null) {
        if (filePath && this.fullResLoadedPath !== filePath) {
            await this.loadFullResolutionForExport(filePath);
        }

        if (!this.originalRawBuffer) {
            console.error("❌ Pas de buffer original pour l'export full res");
            return null;
        }

        // Créer une copie des données originales en pleine résolution (après
        // application des retouches, mises en cache par résolution)
        const retouchedBuffer = this._applyRetouches(this.originalRawBuffer, "fullRes");
        const workingBuffer = this._resolveNeuralDenoiseBuffer(retouchedBuffer);
        let currentImageData = new ImageData(
            new Uint8ClampedArray(workingBuffer.data),
            workingBuffer.width,
            workingBuffer.height
        );

        // Appliquer le pipeline de traitement (Picture Control, etc.)
        if (this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this._buildRenderSettings());
                if (result && result.data) currentImageData = result;
            } catch (err) {
                console.error("❌ Erreur pipeline export full res :", err);
            }
        }

        // Appliquer les masques si activés
        if (this.enableMasks && typeof MaskEngine !== "undefined" && typeof MasksManager !== "undefined") {
            try {
                currentImageData = MaskEngine.applyAllMasks(currentImageData, MasksManager.getMasks(), this.pipeline);
            } catch (err) {
                console.error("❌ Erreur masques export full res :", err);
            }
        }

        // 🔹 Correction de perspective : voir render() pour le raisonnement
        // complet (après le rendu créatif, avant le recadrage/la rotation gravée).
        if (this.perspectiveSettings && this.perspectiveSettings.enabled && typeof PerspectiveEngine !== "undefined") {
            try {
                currentImageData = PerspectiveEngine.applyPerspective(currentImageData, this.perspectiveSettings.corners);
            } catch (err) {
                console.error("❌ Erreur correction de perspective export full res :", err);
            }
        }

        // 🔹 Rotation/inversion RÉELLEMENT gravée dans les pixels (voir
        // _bakeTransform — remplace l'ancien _applyTransformations+putImageData,
        // qui n'avait aucun effet réel ici : putImageData ignore toujours la
        // matrice de transformation du canvas, contrairement à drawImage utilisé
        // par _bakeTransform et par DisplayCanvas.render() pour l'aperçu Studio).
        currentImageData = this._bakeTransform(currentImageData, this.transform);

        // 🔹 Recadrage : une simple fenêtre sur le résultat final déjà tourné
        // (voir applyCrop) — jamais avant, pour que les masques/retouches
        // continuent de fonctionner sur l'image complète.
        currentImageData = this.applyCrop(currentImageData);

        // 🔹 Encadrement : VRAIMENT la toute dernière étape désormais (après
        // perspective/rotation/recadrage, pas avant) — sinon le recadrage
        // coupait une partie du cadre ajouté, et la rotation le faisait
        // pivoter avec le contenu au lieu d'entourer le résultat final (voir
        // FrameUtils.js : "agrandit le canevas, ne recadre jamais dans la photo").
        if (frameOptions && typeof applyFrame === "function") {
            currentImageData = applyFrame(currentImageData, frameOptions);
        }

        // Créer un canvas temporaire en pleine résolution et y dessiner le résultat final
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(currentImageData, 0, 0);

        // Retourner le DataURL
        return tempCanvas.toDataURL(format, quality);
    }

    /**
     * 🔹 Même logique qu'exportFullResolution() (pipeline Picture Control,
     * masques locaux, retouches) mais retourne un PNG sans perte plutôt qu'un
     * JPEG — utilisé pour générer le TIFF envoyé à un programme externe
     * ("Ouvrir avec..."), où une compression avec perte serait indésirable.
     * @param {string} filePath
     * @returns {Promise<string|null>} - DataURL PNG de l'image traitée
     */
    async exportProcessedTiff(filePath) {
        if (filePath && this.fullResLoadedPath !== filePath) {
            await this.loadFullResolutionForExport(filePath);
        }

        if (!this.originalRawBuffer) {
            console.error("❌ Pas de buffer original pour l'export TIFF");
            return null;
        }

        const retouchedBuffer = this._applyRetouches(this.originalRawBuffer, "fullRes");
        const workingBuffer = this._resolveNeuralDenoiseBuffer(retouchedBuffer);
        let currentImageData = new ImageData(
            new Uint8ClampedArray(workingBuffer.data),
            workingBuffer.width,
            workingBuffer.height
        );

        if (this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this._buildRenderSettings());
                if (result && result.data) currentImageData = result;
            } catch (err) {
                console.error("❌ Erreur pipeline export TIFF :", err);
            }
        }

        if (this.enableMasks && typeof MaskEngine !== "undefined" && typeof MasksManager !== "undefined") {
            try {
                currentImageData = MaskEngine.applyAllMasks(currentImageData, MasksManager.getMasks(), this.pipeline);
            } catch (err) {
                console.error("❌ Erreur masques export TIFF :", err);
            }
        }

        if (this.perspectiveSettings && this.perspectiveSettings.enabled && typeof PerspectiveEngine !== "undefined") {
            try {
                currentImageData = PerspectiveEngine.applyPerspective(currentImageData, this.perspectiveSettings.corners);
            } catch (err) {
                console.error("❌ Erreur correction de perspective export TIFF :", err);
            }
        }

        currentImageData = this._bakeTransform(currentImageData, this.transform);
        currentImageData = this.applyCrop(currentImageData);

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(currentImageData, 0, 0);

        return tempCanvas.toDataURL("image/png");
    }

    /**
     * Dimensions de la bounding box (axis-aligned) contenant width×height une
     * fois tourné de transform.rotation (le flip seul ne change pas les
     * dimensions). Utilisé par _bakeTransform pour dimensionner le canevas de
     * sortie, et par CropCanvasController pour contraindre le cadre de
     * recadrage au plus grand rectangle inscriptible dans l'image tournée.
     * @param {number} width
     * @param {number} height
     * @param {{rotation:number}} transform
     * @returns {{width:number, height:number}}
     */
    getRotatedBounds(width, height, transform) {
        const rotation = ((transform.rotation % 360) + 360) % 360;
        const rad = (rotation * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        return {
            width: Math.round(width * cos + height * sin),
            height: Math.round(width * sin + height * cos)
        };
    }

    /**
     * Grave RÉELLEMENT la rotation/inversion dans les pixels, via drawImage
     * (qui respecte la matrice de transformation du canvas) — contrairement à
     * l'ancienne _applyTransformations()+putImageData() qui posait la
     * transformation sur le CONTEXTE puis appelait putImageData(), laquelle
     * IGNORE TOUJOURS cette matrice (comportement standard de l'API Canvas2D,
     * pas un bug qu'on aurait pu activer autrement) : la rotation n'avait donc
     * jusqu'ici aucun effet réel à l'export/impression, seulement sur l'aperçu
     * Studio (voir DisplayCanvas.render(), qui utilise bien drawImage).
     * Le canevas de sortie s'agrandit à la bounding box de l'image tournée
     * (voir getRotatedBounds) — zones hors du contenu d'origine transparentes,
     * jamais visibles tant que le recadrage reste dans le rectangle inscrit.
     * @param {ImageData} imageData
     * @param {{rotation:number, flipH:boolean, flipV:boolean}} transform
     * @returns {ImageData}
     */
    _bakeTransform(imageData, transform) {
        const rotation = ((transform.rotation % 360) + 360) % 360;
        const flipH = !!transform.flipH;
        const flipV = !!transform.flipV;
        if (rotation === 0 && !flipH && !flipV) return imageData;

        const srcCanvas = document.createElement("canvas");
        srcCanvas.width = imageData.width;
        srcCanvas.height = imageData.height;
        srcCanvas.getContext("2d").putImageData(imageData, 0, 0);

        const { width: outW, height: outH } = this.getRotatedBounds(imageData.width, imageData.height, transform);

        const dstCanvas = document.createElement("canvas");
        dstCanvas.width = outW;
        dstCanvas.height = outH;
        const dctx = dstCanvas.getContext("2d");

        dctx.translate(outW / 2, outH / 2);
        if (flipH) dctx.scale(-1, 1);
        if (flipV) dctx.scale(1, -1);
        dctx.rotate((rotation * Math.PI) / 180);
        dctx.drawImage(srcCanvas, -imageData.width / 2, -imageData.height / 2);

        return dctx.getImageData(0, 0, outW, outH);
    }

    /**
     * Découpe imageData (déjà tournée, voir _bakeTransform) selon
     * this.cropSettings — coordonnées normalisées RELATIVES À CETTE IMAGE
     * TOURNÉE, pas à l'image d'origine. No-op si le recadrage n'est pas activé.
     * @param {ImageData} imageData
     * @returns {ImageData}
     */
    applyCrop(imageData) {
        const crop = this.cropSettings;
        if (!crop || !crop.enabled) return imageData;

        const x = Math.round(Math.max(0, Math.min(1, crop.rectX)) * imageData.width);
        const y = Math.round(Math.max(0, Math.min(1, crop.rectY)) * imageData.height);
        const w = Math.min(imageData.width - x, Math.max(1, Math.round(crop.rectWidth * imageData.width)));
        const h = Math.min(imageData.height - y, Math.max(1, Math.round(crop.rectHeight * imageData.height)));
        if (w <= 0 || h <= 0) return imageData;

        const srcCanvas = document.createElement("canvas");
        srcCanvas.width = imageData.width;
        srcCanvas.height = imageData.height;
        srcCanvas.getContext("2d").putImageData(imageData, 0, 0);

        const dstCanvas = document.createElement("canvas");
        dstCanvas.width = w;
        dstCanvas.height = h;
        const dctx = dstCanvas.getContext("2d");
        dctx.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);

        return dctx.getImageData(0, 0, w, h);
    }

    renderMaskOverlay() {
        if (!this.overlayCanvas || !this.display || !this.display.offscreenCanvas.width) return;

        const canvas = this.overlayCanvas;
        const ctx = this.overlayCtx || canvas.getContext("2d");

        canvas.width = this.display.canvas.width;
        canvas.height = this.display.canvas.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 🔹 Panneau Recadrage actif : cadre/poignées/grille des tiers à la place
        // des masques (deux workflows exclusifs) — voir CropCanvasController.js.
        // L'image affichée est déjà axis-aligned (rotation gravée, voir render()),
        // donc la même conversion pan/zoom simple que _drawCropOverlay utilise
        // suffit, sans maths de rotation supplémentaires.
        if (this.cropPanelActive) {
            this._drawCropOverlay(ctx, canvas);
            return;
        }

        if (this.perspectivePanelActive) {
            this._drawPerspectiveOverlay(ctx, canvas);
            return;
        }

        if (typeof MasksManager === "undefined") return;
        if (!this.showMaskOverlay) return;

        const masksToDraw = [];
        const activeMask = MasksManager.getActiveMask();
        const isAiMaskType = (type) => type === "sky" || type === "subject" || type === "background";

        // 🔹 Masques IA (Ciel/Sujet/Arrière-plan) : EXCLUS de l'affichage
        // automatique "masque actif" — leur aplat plein cadre serait sinon
        // TOUJOURS visible dès qu'on sélectionne le masque pour éditer Seuil/
        // Adoucissement (l'activation ne change pas au clic du bouton œil),
        // rendant ce bouton inopérant en pratique : un 2e clic bascule bien
        // showOverlay à false (voir MasksManager.setMaskOverlayVisible), mais
        // ce bloc redessinait quand même l'aplat via le masque actif, ignorant
        // totalement showOverlay. Pour ces types, showOverlay est désormais
        // l'UNIQUE source de vérité (voir boucle ci-dessous).
        if (activeMask && !isAiMaskType(activeMask.type)) {
            masksToDraw.push({ mask: activeMask, live: false });
        }

        for (const mask of MasksManager.getMasks()) {
            if (isAiMaskType(mask.type) && mask.showOverlay) {
                masksToDraw.push({ mask, live: false });
            }
        }

        const controller = this.maskController;
        if (controller && controller.isDrawing && controller.pendingMask) {
            const pending = MasksManager.getMask(controller.pendingMask.id);
            if (pending && (!activeMask || pending.id !== activeMask.id)) {
                masksToDraw.push({ mask: pending, live: true });
            }
        }

        // Cercle d'aperçu de la taille du pinceau : dès que l'outil est actif et
        // survolé, indépendamment de masksToDraw (peut être vide si aucun masque
        // n'existe encore).
        const showBrushPreview = !!(controller && controller.mode === "brush" && controller.brushPreviewPos);

        const retouchController = this.retouchController;
        const showRetouchPreview = !!(retouchController && (
            (retouchController.isDrawing && retouchController.pendingStroke && retouchController.pendingStroke.length) ||
            (retouchController.mode === "heal" && retouchController.hoverPos)
        ));

        if (masksToDraw.length === 0 && !showBrushPreview && !showRetouchPreview) return;

        ctx.save();

        const w = canvas.width;
        const h = canvas.height;
        const imgW = this.display.offscreenCanvas.width;
        const imgH = this.display.offscreenCanvas.height;
        const scale = this.display.scale || 1;
        const panX = this.display.panX || 0;
        const panY = this.display.panY || 0;

        const drawX = (w - imgW * scale) / 2 + panX;
        const drawY = (h - imgH * scale) / 2 + panY;

        ctx.translate(drawX, drawY);
        ctx.scale(scale, scale);

        for (const { mask, live } of masksToDraw) {
            this._drawMaskShape(ctx, imgW, imgH, mask, live, scale);
        }

        if (showBrushPreview) {
            this._drawBrushPreview(ctx, imgW, imgH, controller, scale);
        }

        if (showRetouchPreview) {
            this._drawRetouchPreview(ctx, imgW, imgH, retouchController, scale);
        }

        ctx.restore();
    }

    /**
     * Aperçu d'écrêtage façon Lightroom (Alt+glisser sur Point noir/Point
     * blanc, voir pictureControlPanel.js) : remplace TEMPORAIREMENT l'affichage
     * normal par un aplat noir (Point noir) ou blanc (Point blanc) avec les
     * pixels qui écrêtent mis en évidence, dessiné sur overlayCanvas (même
     * mécanisme déjà utilisé pour les masques/le tampon — voir
     * renderMaskOverlay() ci-dessus) : comme cet overlay est opaque et
     * z-index:100 au-dessus de previewCanvas, il masque entièrement l'image
     * normale sans avoir besoin d'y toucher.
     *
     * Volontairement PLUS LÉGER qu'un render() complet pendant le glissement :
     * exécute le pipeline seulement JUSQU'AU filtre BlackWhitePointFilter (pas
     * les filtres suivants — Tone Curve, Contraste, Mélangeur N&B, Simulation
     * Pellicule, etc.), via RenderPipeline.processRange(). "value" est la
     * valeur EN DIRECT du curseur, pas encore committée dans
     * this.pictureControl (ça n'arrive qu'au prochain render() normal,
     * déclenché par hideClippingPreview()).
     *
     * @param {"blackPoint"|"whitePoint"} field
     * @param {number} value
     */
    showClippingPreview(field, value) {
        if (field !== "blackPoint" && field !== "whitePoint") return;
        if (!this.overlayCanvas || !this.display) return;

        // 🔹 Même court-circuit que render() pendant un glissement de curseur
        // (voir this.isDraggingSlider au constructeur) : l'aperçu d'écrêtage lui-
        // même reste allégé (processRange jusqu'à BlackWhitePointFilter seulement),
        // mais sur un buffer 24 Mpx ce reste de travail peut encore peser pendant
        // le glissement — utilise previewBuffer, comme render(), le temps du geste.
        const usingFullRes = !this.isDraggingSlider
            && this.useFullResForDisplay
            && !!this.currentFilePath
            && this.fullResLoadedPath === this.currentFilePath
            && !!this.originalRawBuffer;
        const rawSourceBuffer = usingFullRes ? this.originalRawBuffer : (this.previewBuffer || this.originalRawBuffer);
        if (!rawSourceBuffer) return;

        const sourceBuffer = this._applyRetouches(rawSourceBuffer, usingFullRes ? "fullRes" : "preview");
        const workingBuffer = this._resolveNeuralDenoiseBuffer(sourceBuffer);

        const preImageData = new ImageData(
            new Uint8ClampedArray(workingBuffer.data),
            workingBuffer.width,
            workingBuffer.height
        );

        let preBwpData = preImageData;
        if (this.pipeline) {
            const bwpIndex = this.pipeline.filters.findIndex(f => f instanceof BlackWhitePointFilter);
            if (bwpIndex > 0) {
                const settings = this._buildRenderSettings();
                settings[field] = value;
                try {
                    preBwpData = this.pipeline.processRange(preImageData, settings, 0, bwpIndex);
                } catch (err) {
                    console.error("❌ Erreur aperçu d'écrêtage :", err);
                    return;
                }
            }
        }

        this._drawClippingOverlay(preBwpData, field, value);
        this._clippingPreviewField = field;
    }

    /**
     * Efface l'aperçu d'écrêtage et restaure l'affichage normal — appelable
     * SANS CONDITION (mouseup du curseur, relâchement de Alt, perte de focus
     * de la fenêtre, voir app.js) : no-op silencieux si aucun aperçu n'est
     * actuellement affiché. Le render() normal ici commet la valeur finale du
     * curseur (déjà dans this.pictureControl via le trigger() debouncé
     * habituel de pictureControlPanel.js) et redessine renderMaskOverlay() par
     * dessus, effaçant naturellement le bitmap de l'aperçu.
     */
    hideClippingPreview() {
        if (!this._clippingPreviewField) return;
        this._clippingPreviewField = null;
        this.render();
    }

    /**
     * Construit le bitmap d'écrêtage (aplat noir/blanc + pixels en alerte) à la
     * résolution NATIVE de imageData (pas celle, potentiellement différente,
     * de l'affichage écran), dessiné dans un canvas hors-écran réutilisé, puis
     * mis à l'échelle en une seule passe via drawImage — bien moins coûteux
     * qu'un scan pixel par pixel à la résolution d'affichage. Même repère
     * translate/scale (pan/zoom) que renderMaskOverlay() pour rester aligné.
     * @private
     */
    _drawClippingOverlay(imageData, field) {
        const canvas = this.overlayCanvas;
        const ctx = this.overlayCtx || canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = this.display.canvas.width;
        canvas.height = this.display.canvas.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const w = imageData.width;
        const h = imageData.height;
        if (!w || !h) return;

        const isBlackPoint = field === "blackPoint";
        const src = imageData.data;

        const bitmap = new ImageData(w, h);
        const dst = bitmap.data;

        // Fond noir uniforme (Point noir) ou blanc uniforme (Point blanc), avec
        // en alerte (bleu vif) les pixels dont au moins un canal RVB écrête —
        // à 0 pour le Point noir, à 255 pour le Point blanc.
        for (let i = 0; i < src.length; i += 4) {
            const clipped = isBlackPoint
                ? (src[i] <= 0 || src[i + 1] <= 0 || src[i + 2] <= 0)
                : (src[i] >= 255 || src[i + 1] >= 255 || src[i + 2] >= 255);

            if (clipped) {
                dst[i] = 40; dst[i + 1] = 140; dst[i + 2] = 255; dst[i + 3] = 255;
            } else {
                const bg = isBlackPoint ? 0 : 255;
                dst[i] = bg; dst[i + 1] = bg; dst[i + 2] = bg; dst[i + 3] = 255;
            }
        }

        if (!this._clippingPreviewCanvas) this._clippingPreviewCanvas = document.createElement("canvas");
        const off = this._clippingPreviewCanvas;
        off.width = w;
        off.height = h;
        off.getContext("2d").putImageData(bitmap, 0, 0);

        // 🔹 Repère identique à renderMaskOverlay() (drawX/drawY/scale), pour que
        // l'aperçu reste aligné avec la photo quel que soit le pan/zoom actuel.
        const scale = this.display.scale || 1;
        const panX = this.display.panX || 0;
        const panY = this.display.panY || 0;
        const drawX = (canvas.width - w * scale) / 2 + panX;
        const drawY = (canvas.height - h * scale) / 2 + panY;

        ctx.imageSmoothingEnabled = false; // lecture exacte des pixels écrêtés, pas de flou d'interpolation
        ctx.drawImage(off, drawX, drawY, w * scale, h * scale);
    }

    /**
     * Dessine le cadre de recadrage (voile semi-transparent hors cadre,
     * bordure, grille des tiers, 8 poignées) en coordonnées pan/zoom simples —
     * l'image est déjà axis-aligned à ce stade (rotation gravée dans les
     * pixels, voir render()). Le rectangle lui-même vit dans this.cropSettings,
     * muté en direct par CropCanvasController (comme RetouchManager pour les
     * retouches) — défaut plein cadre si le recadrage n'a jamais été touché.
     * @private
     */
    _drawCropOverlay(ctx, canvas) {
        const imgW = this.display.offscreenCanvas.width;
        const imgH = this.display.offscreenCanvas.height;
        const scale = this.display.scale || 1;
        const panX = this.display.panX || 0;
        const panY = this.display.panY || 0;

        const drawX = (canvas.width - imgW * scale) / 2 + panX;
        const drawY = (canvas.height - imgH * scale) / 2 + panY;

        const crop = this.cropSettings || { rectX: 0, rectY: 0, rectWidth: 1, rectHeight: 1 };
        const rx = crop.rectX * imgW, ry = crop.rectY * imgH;
        const rw = crop.rectWidth * imgW, rh = crop.rectHeight * imgH;

        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.scale(scale, scale);

        // Voile semi-transparent sur toute l'image SAUF le cadre (règle even-odd :
        // rectangle image "plein" + rectangle cadre "trou").
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, imgW, imgH);
        ctx.rect(rx, ry, rw, rh);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fill("evenodd");
        ctx.restore();

        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = "#ffffff";
        ctx.strokeRect(rx, ry, rw, rh);

        // Grille règle des tiers, uniquement à l'intérieur du cadre.
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1 / scale;
        for (let i = 1; i <= 2; i++) {
            const gx = rx + (rw * i) / 3;
            ctx.beginPath();
            ctx.moveTo(gx, ry);
            ctx.lineTo(gx, ry + rh);
            ctx.stroke();

            const gy = ry + (rh * i) / 3;
            ctx.beginPath();
            ctx.moveTo(rx, gy);
            ctx.lineTo(rx + rw, gy);
            ctx.stroke();
        }

        // 8 poignées : 4 coins + 4 côtés (mêmes points que CropCanvasController._hitTest).
        const handleR = 5 / scale;
        const handlePoints = [
            [rx, ry], [rx + rw / 2, ry], [rx + rw, ry],
            [rx, ry + rh / 2], [rx + rw, ry + rh / 2],
            [rx, ry + rh], [rx + rw / 2, ry + rh], [rx + rw, ry + rh]
        ];
        ctx.fillStyle = "#ffffff";
        for (const [hx, hy] of handlePoints) {
            ctx.beginPath();
            ctx.arc(hx, hy, handleR, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    /**
     * Dessine le quadrilatère de correction de perspective (4 poignées reliées
     * par un contour) en coordonnées pan/zoom simples — voir
     * PerspectiveCanvasController pour la justification de l'absence de maths
     * de rotation ici (même limitation déjà acceptée pour les masques).
     * @private
     */
    _drawPerspectiveOverlay(ctx, canvas) {
        const persp = this.perspectiveSettings || {
            corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
        };
        const imgW = this.display.offscreenCanvas.width;
        const imgH = this.display.offscreenCanvas.height;
        const scale = this.display.scale || 1;
        const panX = this.display.panX || 0;
        const panY = this.display.panY || 0;

        const drawX = (canvas.width - imgW * scale) / 2 + panX;
        const drawY = (canvas.height - imgH * scale) / 2 + panY;

        const pts = persp.corners.map(c => ({ x: c.x * imgW, y: c.y * imgH }));
        const order = [0, 1, 3, 2]; // [tl,tr,bl,br] -> tracé tl-tr-br-bl-tl

        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.scale(scale, scale);

        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        order.forEach((idx, i) => {
            const p = pts[idx];
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.stroke();

        const handleR = 6 / scale;
        ctx.fillStyle = "#ffffff";
        for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, handleR, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    /**
     * Aperçu du tampon de duplication : cercle plein à la position de
     * destination (pinceau) et cercle pointillé à la position source
     * correspondante (décalage figé pendant le tracé en cours).
     */
    _drawRetouchPreview(ctx, width, height, controller, scale = 1) {
        let destPos = null;

        if (controller.isDrawing && controller.pendingStroke && controller.pendingStroke.length) {
            destPos = controller.pendingStroke[controller.pendingStroke.length - 1];
        } else if (controller.hoverPos) {
            destPos = controller.hoverPos;
        }
        if (!destPos) return;

        const radiusPx = Math.max(1, controller.brushSize * width);
        const dcx = destPos.x * width;
        const dcy = destPos.y * height;

        ctx.save();
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = "#00aaff";
        ctx.beginPath();
        ctx.arc(dcx, dcy, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        if (controller.lockedOffset) {
            const scx = (destPos.x + controller.lockedOffset.dx) * width;
            const scy = (destPos.y + controller.lockedOffset.dy) * height;

            ctx.save();
            ctx.lineWidth = 1.25 / scale;
            ctx.strokeStyle = "#ffd166";
            ctx.setLineDash([4 / scale, 3 / scale]);
            ctx.beginPath();
            ctx.arc(scx, scy, radiusPx, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    /**
     * Cercle fin, non rempli, à la position survolée par la souris, de rayon
     * égal à la taille de pinceau actuelle (même conversion que MaskEngine :
     * radius normalisé * largeur de l'image).
     */
    _drawBrushPreview(ctx, width, height, controller, scale = 1) {
        const pos = controller.brushPreviewPos;
        if (!pos) return;

        const cx = pos.x * width;
        const cy = pos.y * height;
        const radiusPx = Math.max(1, controller.brushSize * width);

        ctx.save();
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = "#00aaff";
        ctx.beginPath();
        ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    _drawMaskShape(ctx, width, height, mask, live, scale = 1) {
        ctx.save();
        ctx.lineWidth = live ? 2 / scale : 1.5 / scale;
        ctx.strokeStyle = live ? "#ffffff" : "#00aaff";
        ctx.fillStyle = live ? "#ffffff" : "#00aaff";

        if (mask.type === "linear") {
            const g = mask.geometry;
            const ax = g.x1 * width, ay = g.y1 * height;
            const bx = g.x2 * width, by = g.y2 * height;

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();

            const dx = bx - ax, dy = by - ay;
            const len = Math.hypot(dx, dy) || 1;
            const perpX = -dy / len, perpY = dx / len;
            const bandHalf = Math.max(width, height);

            ctx.setLineDash([4 / scale, 4 / scale]);
            [[ax, ay], [bx, by]].forEach(([px, py]) => {
                ctx.beginPath();
                ctx.moveTo(px - perpX * bandHalf, py - perpY * bandHalf);
                ctx.lineTo(px + perpX * bandHalf, py + perpY * bandHalf);
                ctx.stroke();
            });

            ctx.setLineDash([]);
            [[ax, ay], [bx, by]].forEach(([px, py]) => {
                ctx.beginPath();
                ctx.arc(px, py, 5 / scale, 0, Math.PI * 2);
                ctx.fill();
            });

        } else if (mask.type === "radial") {
            const g = mask.geometry;
            const cx = g.cx * width, cy = g.cy * height;
            const rx = Math.max(1, g.radiusX * width);
            const ry = Math.max(1, g.radiusY * height);
            const angleRad = ((g.angle || 0) * Math.PI) / 180;

            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, angleRad, 0, Math.PI * 2);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, 4 / scale, 0, Math.PI * 2);
            ctx.fill();

        } else if (mask.type === "brush") {
            this._drawBrushMaskFill(ctx, width, height, mask);
        } else if (mask.type === "sky" || mask.type === "subject" || mask.type === "background") {
            this._drawAiMaskFill(ctx, width, height, mask);
        }

        ctx.restore();
    }

    /**
     * Peint un aplat semi-transparent rouge à partir d'une alpha map déjà
     * calculée (0..1, largeur×hauteur PLEINE IMAGE), limité à la zone
     * [minX,minY]-[maxX,maxY] pour ne pas traiter/dessiner l'image entière
     * quand la zone réelle est plus petite (masque Pinceau localisé).
     * Utilisé par _drawBrushMaskFill (bbox des traits) et _drawAiMaskFill
     * (bbox = image entière, la zone IA pouvant couvrir n'importe où).
     */
    _paintAlphaOverlay(ctx, width, minX, minY, maxX, maxY, alpha) {
        const boxW = maxX - minX;
        const boxH = maxY - minY;
        if (boxW <= 0 || boxH <= 0) return;

        const imgData = new ImageData(boxW, boxH);
        const data = imgData.data;
        const OVERLAY_MAX_ALPHA = 130; // ~50% d'opacité max, convention Lightroom

        for (let y = 0; y < boxH; y++) {
            for (let x = 0; x < boxW; x++) {
                const srcIdx = (y + minY) * width + (x + minX);
                const a = alpha[srcIdx];
                const dstIdx = (y * boxW + x) * 4;
                data[dstIdx]     = 255; // rouge
                data[dstIdx + 1] = 40;
                data[dstIdx + 2] = 40;
                data[dstIdx + 3] = Math.round(a * OVERLAY_MAX_ALPHA);
            }
        }

        const off = document.createElement("canvas");
        off.width = boxW;
        off.height = boxH;
        off.getContext("2d").putImageData(imgData, 0, 0);

        ctx.drawImage(off, minX, minY);
    }

    /**
     * Aplat semi-transparent rouge épousant la vraie forme peinte (mêmes
     * bords doux que le traitement réel, via MaskEngine.computeBrushAlpha),
     * plutôt qu'un simple tracé en pointillés suivant les points bruts.
     */
    _drawBrushMaskFill(ctx, width, height, mask) {
        const strokes = mask.geometry.strokes || [];
        if (!strokes.length) return;

        // Bounding box réel du masque (tous les points, rayon inclus), pour
        // ne traiter/dessiner qu'une petite zone plutôt que l'image entière
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const stroke of strokes) {
            for (const p of stroke) {
                const r = Math.max(1, p.radius * width);
                const cx = p.x * width, cy = p.y * height;
                minX = Math.min(minX, cx - r);
                maxX = Math.max(maxX, cx + r);
                minY = Math.min(minY, cy - r);
                maxY = Math.max(maxY, cy + r);
            }
        }
        if (!isFinite(minX)) return;

        minX = Math.max(0, Math.floor(minX));
        minY = Math.max(0, Math.floor(minY));
        maxX = Math.min(width, Math.ceil(maxX));
        maxY = Math.min(height, Math.ceil(maxY));

        // Alpha réel du masque (même fonction que le traitement de l'image,
        // donc bords doux selon la dureté, identique au résultat final)
        const alpha = MaskEngine.computeBrushAlpha(width, height, mask.geometry);
        this._paintAlphaOverlay(ctx, width, minX, minY, maxX, maxY, alpha);
    }

    /**
     * Aplat semi-transparent rouge pour Ciel/Sujet/Arrière-plan, à partir de
     * la MÊME fonction que le rendu réel (MaskEngine.computeAlpha, donc
     * Seuil/Adoucissement/Inversion inclus) — l'aperçu correspond exactement
     * à l'effet réellement appliqué. Pas de bounding box réduite : la zone IA
     * peut couvrir n'importe quelle portion de l'image.
     */
    _drawAiMaskFill(ctx, width, height, mask) {
        const alpha = MaskEngine.computeAlpha(width, height, mask);
        this._paintAlphaOverlay(ctx, width, 0, 0, width, height, alpha);
    }
}

window.imageProcessor = new ImageProcessor("previewCanvas");