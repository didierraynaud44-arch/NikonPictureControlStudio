/*=========================================================
    Nikon Picture Control Studio - Image Processor (Fix Overlay)
=========================================================*/

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

        // 🔹 Chemin de la photo actuellement affichée dans le Studio (mis à jour par
        // l'appelant, voir app.js/loadImageInStudio) et flag indiquant si l'affichage
        // doit utiliser this.originalRawBuffer en pleine résolution plutôt que
        // this.previewBuffer (voir ensureFullResolutionLoaded, zoom > seuil).
        this.currentFilePath = null;
        this.useFullResForDisplay = false;

        this.display = new DisplayCanvas(canvasId);
        this.display.onRequestFullRes = async () => {
            if (!this.currentFilePath) return;
            await this.ensureFullResolutionLoaded(this.currentFilePath);
            this.render();
        };

        this.overlayCanvas = document.getElementById("maskOverlayCanvas");
        this.overlayCtx = this.overlayCanvas ? this.overlayCanvas.getContext("2d") : null;

        this.transform = { rotation: 0, flipH: false, flipV: false };
        this.pictureControl = null;
        this.pipeline = new RenderPipeline();

        this.enableMasks = true;
        this.maskController = null;
        this.showMaskOverlay = true;

        // 🔹 Gomme du module Monochrome : contrôleur dédié (voir
        // MonochromeMaskCanvasController.js), même rôle que maskController/
        // retouchController pour l'aperçu du cercle de pinceau en survol.
        this.monochromeMaskController = null;

        // 🔹 Retouche (tampon de duplication) : appliquée une fois, en amont du
        // pipeline. Cache par clé de résolution ("preview"/"fullRes"), invalidé
        // automatiquement si le buffer source change (nouvelle photo) ou si la
        // liste de RetouchManager change (RetouchManager.getVersion()).
        this.retouchController = null;
        this._retouchCache = {};

        // 🔹 NOUVEAU : Histogramme
        this.histogramMode = "luminance"; // "luminance" | "rgb"
        this._lastImageDataForHistogram = null;

        // 🔹 Simulation Pellicule (grain, halation, Hald-CLUT) : réglages séparés
        // de this.pictureControl (et non fusionnés dedans), car readState() du
        // panneau Picture Control reconstruit un objet ne contenant QUE les champs
        // Picture Control connus à chaque changement de curseur — les stocker dans
        // pictureControl les ferait donc écraser au premier réglage PC modifié.
        // Même principe que RetouchManager pour les retouches. Les pixels bruts du
        // Hald-CLUT chargé (haldClutState) ne sont eux jamais persistés : seul le
        // chemin (filmSettings.haldClutPath) l'est, et le LUT est rechargé depuis
        // le disque via setFilmSettings() à la réouverture de la photo.
        this.filmSettings = {
            grainIntensity: 0,
            grainSize: 1,
            halationIntensity: 0,
            halationThreshold: 200,
            halationRadius: 8,
            haldClutPath: null,
            haldClutIntensity: 100
        };
        this.haldClutState = null; // { path, imageData, side }

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

        // 🔹 Module Monochrome dédié du Studio (mixeur N&B -> Lumière tamisée ->
        // Dodge & Burn), indépendant du profil Nikon Monochrome ci-dessus. La
        // Gomme locale (voir _buildRenderSettings) réduit l'effet de CHAQUE
        // réglage indépendamment via des cartes de multiplicateur transmises
        // en settings — ces 3 filtres restent donc de simples filtres du
        // pipeline, exécutés en une seule passe comme tous les autres.
        if (typeof MonochromeMixerFilter !== "undefined") this.pipeline.add(new MonochromeMixerFilter());
        if (typeof SoftLightPunchFilter !== "undefined") this.pipeline.add(new SoftLightPunchFilter());
        if (typeof DodgeBurnFilter !== "undefined") this.pipeline.add(new DodgeBurnFilter());

        if (typeof DehazeFilter !== "undefined") this.pipeline.add(new DehazeFilter());
        if (typeof VibranceFilter !== "undefined") this.pipeline.add(new VibranceFilter());
        if (typeof SCurveFilter !== "undefined") this.pipeline.add(new SCurveFilter());
        if (typeof LensCorrectionFilter !== "undefined") this.pipeline.add(new LensCorrectionFilter());
        if (typeof VignetteFilter !== "undefined") this.pipeline.add(new VignetteFilter());
        if (typeof DenoiseFilter !== "undefined") this.pipeline.add(new DenoiseFilter());

        // 🔹 Simulation Pellicule : toute fin du pipeline, après Picture Control/
        // Monochrome/masques. Ordre développement -> halation optique -> grain du
        // support, cohérent avec un vrai process argentique.
        if (typeof HaldClutFilter !== "undefined") this.pipeline.add(new HaldClutFilter());
        if (typeof HalationFilter !== "undefined") this.pipeline.add(new HalationFilter());
        if (typeof FilmGrainFilter !== "undefined") this.pipeline.add(new FilmGrainFilter());
    }

    /**
     * Fusionne pictureControl et filmSettings en un seul objet de réglages pour
     * le pipeline, en y injectant les pixels du Hald-CLUT actuellement chargé en
     * mémoire (jamais persistés, voir le commentaire du constructeur).
     * @param {number} [width] - Dimensions de l'image à traiter, nécessaires pour
     *        calculer les cartes de multiplicateur local de la Gomme locale
     *        (voir _injectMonoLocalMultipliers). Omises : pas de gomme locale
     *        (ex. aperçus sans dimensions connues à l'avance).
     * @param {number} [height]
     * @private
     */
    _buildRenderSettings(width, height) {
        const settings = { ...(this.pictureControl || {}), ...(this.filmSettings || {}) };
        if (this.haldClutState) {
            settings.haldClutData = this.haldClutState.imageData;
            settings.haldClutSide = this.haldClutState.side;
        }

        // 🔹 Module Monochrome dédié : réglages lus directement depuis
        // MonochromeManager (état global, comme MasksManager.getMasks()), pas
        // stockés sur l'instance. N'injecte les réglages QUE si le module est
        // activé — c'est ce qui fait de monoMixerEnabled un vrai interrupteur
        // maître pour les 3 filtres à la fois : désactivé, aucune des clés
        // (softLightIntensity, dodgeBurnWhite...) n'est présente dans settings,
        // donc chaque filtre s'arrête tout seul via son propre court-circuit,
        // sans qu'on ait à modifier leur logique individuelle.
        if (typeof MonochromeManager !== "undefined") {
            const monoSettings = MonochromeManager.getSettings();
            if (monoSettings && monoSettings.monoMixerEnabled) {
                Object.assign(settings, monoSettings);
                if (width && height) {
                    this._injectMonoLocalMultipliers(settings, monoSettings, width, height);
                }
            }
        }

        return settings;
    }

    /**
     * Gomme locale du module Monochrome : calcule, pour chacune des 10 cibles
     * (8 canaux du mixeur + Dodge & Burn + Punch) ayant au moins un trait
     * peint, une carte Float32Array où chaque pixel vaut :
     *     1 - (MaskEngine.computeBrushAlpha(...) × (intensité / 100))
     * soit 1.0 = effet plein, 0 = effet totalement supprimé à ce pixel, pour
     * cette cible précise. Transmises aux filtres via settings.
     * channelLocalMultipliers/dodgeBurnLocalMultiplier/punchLocalMultiplier —
     * l'image reste N&B partout, seule L'INTENSITÉ du réglage ciblé varie
     * localement (contrairement à l'ancienne "Gomme couleur" qui révélait la
     * couleur d'origine, entièrement retirée).
     * @private
     */
    _injectMonoLocalMultipliers(settings, monoSettings, width, height) {
        if (typeof MaskEngine === "undefined") return;
        const masks = monoSettings.monoEraseMasks;
        if (!masks) return;

        const channelKeys = typeof MonochromeMixerFilter !== "undefined" ? MonochromeMixerFilter.CHANNEL_KEYS : [];
        const channelMultipliers = {};
        let hasChannelMultiplier = false;
        for (const key of channelKeys) {
            const mult = this._computeLocalMultiplier(masks[key], width, height);
            if (mult) {
                channelMultipliers[key] = mult;
                hasChannelMultiplier = true;
            }
        }
        if (hasChannelMultiplier) settings.channelLocalMultipliers = channelMultipliers;

        const dodgeBurnMult = this._computeLocalMultiplier(masks.dodgeBurn, width, height);
        if (dodgeBurnMult) settings.dodgeBurnLocalMultiplier = dodgeBurnMult;

        const punchMult = this._computeLocalMultiplier(masks.punch, width, height);
        if (punchMult) settings.punchLocalMultiplier = punchMult;
    }

    /**
     * @param {{geometry:{strokes:Array}, intensity:number}} entry - une entrée de monoEraseMasks
     * @returns {Float32Array|null} null si rien de peint (ou intensité nulle) pour cette cible
     * @private
     */
    _computeLocalMultiplier(entry, width, height) {
        if (!entry || !entry.geometry || !Array.isArray(entry.geometry.strokes) || !entry.geometry.strokes.length) {
            return null;
        }
        const intensity = Math.max(0, Math.min(100, entry.intensity ?? 100)) / 100;
        if (intensity <= 0) return null;

        const alpha = MaskEngine.computeBrushAlpha(width, height, entry.geometry);
        const mult = new Float32Array(alpha.length);
        for (let i = 0; i < alpha.length; i++) mult[i] = 1 - alpha[i] * intensity;
        return mult;
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
        this.filmSettings = {
            grainIntensity: 0,
            grainSize: 1,
            halationIntensity: 0,
            halationThreshold: 200,
            halationRadius: 8,
            haldClutPath: null,
            haldClutIntensity: 100,
            ...(settings || {})
        };

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
     */
    updateFilmSetting(field, value) {
        if (!this.filmSettings) this.filmSettings = {};
        this.filmSettings[field] = value;
        if (this.originalRawBuffer) this.render();
    }

    /**
     * Charge un fichier Hald-CLUT (PNG) depuis le disque et le décode en ImageData
     * via un canvas temporaire (même approche que le reste de l'app pour charger
     * une image locale). Seul le CHEMIN est conservé dans filmSettings pour la
     * persistance par photo — les pixels restent en mémoire (this.haldClutState).
     */
    async loadHaldClutFile(filePath) {
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

        if (this.originalRawBuffer) this.render();
        return this.haldClutState;
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
                    aperture: metadata.aperture || 0
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
     */
    _applyRetouches(sourceBuffer, cacheKey) {
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

    render() {
        // 🔹 Zoom pleine résolution (Studio) : une fois ensureFullResolutionLoaded()
        // résolu pour LA PHOTO ACTUELLEMENT AFFICHÉE, l'affichage bascule sur
        // this.originalRawBuffer (pleine résolution) plutôt que this.previewBuffer.
        // La vérification fullResLoadedPath === currentFilePath évite d'utiliser
        // par erreur un buffer pleine résolution d'une AUTRE photo déjà en cache.
        const usingFullRes = this.useFullResForDisplay
            && this.fullResLoadedPath === this.currentFilePath
            && !!this.originalRawBuffer;

        const rawSourceBuffer = usingFullRes ? this.originalRawBuffer : (this.previewBuffer || this.originalRawBuffer);
        if (!rawSourceBuffer || !this.display) return;

        const sourceBuffer = this._applyRetouches(rawSourceBuffer, usingFullRes ? "fullRes" : "preview");

        let currentImageData = new ImageData(
            new Uint8ClampedArray(sourceBuffer.data),
            sourceBuffer.width,
            sourceBuffer.height
        );

        if (this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this._buildRenderSettings(currentImageData.width, currentImageData.height));
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

        if (typeof this.display.setTransform === "function") {
            this.display.setTransform(this.transform);
        }

        this.display.draw(currentImageData, { preserveView: usingFullRes });
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
                const result = this.pipeline.process(currentImageData, this._buildRenderSettings(currentImageData.width, currentImageData.height));
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
            // déjà utilisée pour le chargement rapide dans le Studio.
            if (!imageData) {
                console.warn("⚠️ Décodage RAW pleine résolution indisponible, repli sur la vignette embarquée");
                const fallback = await window.electronAPI.readFileDirect(filePath);
                if (fallback && fallback.preview) {
                    imageData = await this._dataUrlToImageData(fallback.preview);
                }
            }
        } else if (result.dataUrl) {
            imageData = await this._dataUrlToImageData(result.dataUrl);
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
    _dataUrlToImageData(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
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
        let currentImageData = new ImageData(
            new Uint8ClampedArray(retouchedBuffer.data),
            retouchedBuffer.width,
            retouchedBuffer.height
        );

        // Appliquer le pipeline de traitement (Picture Control, etc.)
        if (this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this._buildRenderSettings(currentImageData.width, currentImageData.height));
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

        // Encadrement : toute dernière étape, après pipeline + masques, avant la
        // mise en canvas finale (voir FrameUtils.js — agrandit le canevas, ne
        // recadre jamais dans la photo).
        if (frameOptions && typeof applyFrame === "function") {
            currentImageData = applyFrame(currentImageData, frameOptions);
        }

        // Créer un canvas temporaire en pleine résolution
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");

        // Appliquer les transformations (rotation, flip)
        this._applyTransformations(tempCtx, tempCanvas.width, tempCanvas.height);

        // Dessiner l'image traitée
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
        let currentImageData = new ImageData(
            new Uint8ClampedArray(retouchedBuffer.data),
            retouchedBuffer.width,
            retouchedBuffer.height
        );

        if (this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this._buildRenderSettings(currentImageData.width, currentImageData.height));
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

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");

        this._applyTransformations(tempCtx, tempCanvas.width, tempCanvas.height);
        tempCtx.putImageData(currentImageData, 0, 0);

        return tempCanvas.toDataURL("image/png");
    }

    /**
     * Applique les transformations (rotation, flip) au contexte
     * @private
     */
    _applyTransformations(ctx, width, height) {
        const rotation = this.transform.rotation % 360;
        const flipH = this.transform.flipH;
        const flipV = this.transform.flipV;

        if (rotation !== 0 || flipH || flipV) {
            ctx.translate(width / 2, height / 2);

            if (flipH) ctx.scale(-1, 1);
            if (flipV) ctx.scale(1, -1);

            ctx.rotate((rotation * Math.PI) / 180);
            ctx.translate(-width / 2, -height / 2);
        }
    }

    renderMaskOverlay() {
        if (!this.overlayCanvas || !this.display || !this.display.offscreenCanvas.width) return;
        if (typeof MasksManager === "undefined") return;

        const canvas = this.overlayCanvas;
        const ctx = this.overlayCtx || canvas.getContext("2d");

        canvas.width = this.display.canvas.width;
        canvas.height = this.display.canvas.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!this.showMaskOverlay) return;

        const masksToDraw = [];
        const activeMask = MasksManager.getActiveMask();
        if (activeMask) masksToDraw.push({ mask: activeMask, live: false });

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

        // Gomme couleur du module Monochrome : même logique de survol que le
        // Tampon de duplication (simple cercle, pas d'aplat semi-transparent).
        const monochromeMaskController = this.monochromeMaskController;
        const showErasePreview = !!(monochromeMaskController && monochromeMaskController.mode === "erase" && monochromeMaskController.hoverPos);

        if (masksToDraw.length === 0 && !showBrushPreview && !showRetouchPreview && !showErasePreview) return;

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

        if (showErasePreview) {
            this._drawBrushPreview(ctx, imgW, imgH, { brushPreviewPos: monochromeMaskController.hoverPos, brushSize: monochromeMaskController.brushSize }, scale);
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
        }

        ctx.restore();
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
        const boxW = maxX - minX;
        const boxH = maxY - minY;
        if (boxW <= 0 || boxH <= 0) return;

        // Alpha réel du masque (même fonction que le traitement de l'image,
        // donc bords doux selon la dureté, identique au résultat final)
        const alpha = MaskEngine.computeBrushAlpha(width, height, mask.geometry);

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
}

window.imageProcessor = new ImageProcessor("previewCanvas");