/*=========================================================
    Nikon Picture Control Studio - Image Processor (complet)
=========================================================*/

class ImageProcessor {

    constructor(canvasId) {
        this.buffer = new ImageBuffer();
        this.originalRawBuffer = null;
        this.previewBuffer = null;
        this.loadedImage = null;
        this.currentOrientation = 1;
        this.currentLensInfo = null; // 📷 Stockage des métadonnées optiques
        this.display = new DisplayCanvas(canvasId);

        // 🔍 Gestion du Zoom & Pan
        this.zoom = 1;
        this.minZoom = 0.5;
        this.maxZoom = 5;
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;

        this.pictureControl = null;
        this.pipeline = new RenderPipeline();

        // ---------------------------------------------------------
        // 1. PIPELINE PICTURE CONTROL NIKON (Officiel)
        // ---------------------------------------------------------
        // En premier : Monochrome pour basculer en N&B selon le filtre optique
        if (typeof MonochromeFilter !== "undefined") this.pipeline.add(new MonochromeFilter());

        // Réglages natifs Nikon
        if (typeof SharpenFilter !== "undefined") this.pipeline.add(new SharpenFilter());
        if (typeof MidRangeSharpenFilter !== "undefined") this.pipeline.add(new MidRangeSharpenFilter());
        if (typeof ClarityFilter !== "undefined") this.pipeline.add(new ClarityFilter());
        if (typeof ContrastFilter !== "undefined") this.pipeline.add(new ContrastFilter());
        if (typeof BrightnessFilter !== "undefined") this.pipeline.add(new BrightnessFilter());
        if (typeof SaturationFilter !== "undefined") this.pipeline.add(new SaturationFilter());

        // ---------------------------------------------------------
        // 2. TRAITEMENT DE L'IMAGE & CORRECTIONS OPTIQUES
        // ---------------------------------------------------------
        if (typeof HighlightsFilter !== "undefined") this.pipeline.add(new HighlightsFilter());
        if (typeof ShadowsFilter !== "undefined") this.pipeline.add(new ShadowsFilter());
        if (typeof DehazeFilter !== "undefined") this.pipeline.add(new DehazeFilter());
        if (typeof VibranceFilter !== "undefined") this.pipeline.add(new VibranceFilter());
        if (typeof SCurveFilter !== "undefined") this.pipeline.add(new SCurveFilter());

        // 🎯 Correction optique de l'objectif (Géométrie)
        if (typeof LensCorrectionFilter !== "undefined") this.pipeline.add(new LensCorrectionFilter());

        if (typeof VignetteFilter !== "undefined") this.pipeline.add(new VignetteFilter());
        if (typeof DenoiseFilter !== "undefined") this.pipeline.add(new DenoiseFilter());

        // Virages et Étalonnage couleur
        if (typeof ToneCurveFilter !== "undefined") this.pipeline.add(new ToneCurveFilter());
        if (typeof ColorBlenderFilter !== "undefined") this.pipeline.add(new ColorBlenderFilter());
        if (typeof ColorGradingFilter !== "undefined") this.pipeline.add(new ColorGradingFilter());

        // Initialisation des contrôles interactifs Canvas
        this.initZoomAndPanEvents();
    }

    /**
     * Écouteurs d'événements pour le Zoom et le Déplacement (Pan)
     */
    initZoomAndPanEvents() {
        const canvas = this.display?.canvas;
        if (!canvas) return;

        // 1. Zoom à la molette
        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();

            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            const newZoom = Math.min(Math.max(this.zoom * zoomFactor, this.minZoom), this.maxZoom);

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
            this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
            this.zoom = newZoom;

            this.render();
        }, { passive: false });

        // 2. Glisser-déplacer (Pan)
        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            this.isDragging = true;
            this.dragStartX = e.clientX - this.panX;
            this.dragStartY = e.clientY - this.panY;
            canvas.style.cursor = "grabbing";
        });

        window.addEventListener("mousemove", (e) => {
            if (!this.isDragging) return;
            this.panX = e.clientX - this.dragStartX;
            this.panY = e.clientY - this.dragStartY;
            this.render();
        });

        window.addEventListener("mouseup", () => {
            if (this.isDragging) {
                this.isDragging = false;
                if (canvas) canvas.style.cursor = "grab";
            }
        });

        // 3. Double-clic pour réinitialiser
        canvas.addEventListener("dblclick", () => {
            this.resetZoom();
        });

        canvas.style.cursor = "grab";
    }

    resetZoom() {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.render();
    }

    /**
     * Redressement EXIF et pivot du Canvas
     */
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

    /**
     * Chargement de la source image + transmission des métadonnées EXIF/Objectif
     */
    load(imageSrc, orientation = 1, metadata = {}) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";

            img.onload = () => {
                this.loadedImage = img;
                this.currentOrientation = Number(orientation) || 1;

                // Conservation des métadonnées de l'objectif
                this.currentLensInfo = {
                    model: metadata.lens || "Generic",
                    focalLength: metadata.focalLength || 0,
                    aperture: metadata.aperture || 0
                };

                this.zoom = 1;
                this.panX = 0;
                this.panY = 0;

                // Buffer pleine définition
                const fullCanvas = this.createRotatedCanvas(img, this.currentOrientation);
                const fullCtx = fullCanvas.getContext("2d");
                this.originalRawBuffer = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);

                // Buffer de prévisualisation (1600px max)
                const previewCanvas = this.createRotatedCanvas(img, this.currentOrientation, 1600);
                const previewCtx = previewCanvas.getContext("2d");
                this.previewBuffer = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

                if (this.display && this.display.canvas) {
                    this.display.canvas.width = previewCanvas.width;
                    this.display.canvas.height = previewCanvas.height;
                }

                this.initZoomAndPanEvents();

                console.log(`✅ Image chargée (${fullCanvas.width}x${fullCanvas.height}) | Orientation: ${this.currentOrientation} | Objectif: ${this.currentLensInfo.model}`);
                this.render();
                resolve(this.originalRawBuffer);
            };

            img.onerror = (err) => {
                console.error("❌ Erreur de chargement de l'image :", err);
                reject(err);
            };

            img.src = imageSrc;
        });
    }

    /**
     * Nettoyage et parsing des paramètres du Picture Control
     */
    cleanPictureControl(pcData) {
        if (!pcData) return {};
        
        const clean = { ...pcData };
        const parseValue = (val) => {
            if (typeof val === "number") return val;
            if (val === "Normal" || !val) return 0;
            const parsed = parseFloat(val);
            return isNaN(parsed) ? 0 : parsed;
        };

        // --- Réglages Nikon Officiels ---
        clean.sharpening = parseValue(clean.sharpening ?? clean.sharpness ?? clean.sharpning);
        clean.midRangeSharpening = parseValue(clean.midRangeSharpening ?? clean.midRangeSharpning);
        clean.clarity = parseValue(clean.clarity);
        clean.contrast = parseValue(clean.contrast);
        clean.brightness = parseValue(clean.brightness ?? clean.Brightness);
        clean.saturation = parseValue(clean.saturation);
        clean.hue = parseValue(clean.hue);

        // --- Traitement de l'image & Corrections ---
        clean.highlights = parseValue(clean.highlights);
        clean.shadows = parseValue(clean.shadows);
        clean.dehaze = parseValue(clean.dehaze);
        clean.vibrance = parseValue(clean.vibrance);
        clean.sCurve = parseValue(clean.sCurve);
        clean.vignette = parseValue(clean.vignette);
        clean.denoise = parseValue(clean.denoise);

        // Options optiques
        clean.lensCorrection = Boolean(clean.lensCorrection);
        clean.lensInfo = this.currentLensInfo || clean.lensInfo || {};

        return clean;
    }

    setPictureControl(pcData) {
        this.pictureControl = this.cleanPictureControl(pcData);

        if (!this.originalRawBuffer) return;
        this.render();
    }

    /**
     * Rendu et exécution du pipeline
     */
    render() {
        const sourceBuffer = this.previewBuffer || this.originalRawBuffer;
        if (!sourceBuffer || !this.display || !this.display.canvas) return;

        const canvas = this.display.canvas;

        // 1. Copie des pixels source
        let currentImageData = new ImageData(
            new Uint8ClampedArray(sourceBuffer.data),
            sourceBuffer.width,
            sourceBuffer.height
        );

        // 2. Traitement par la chaîne de filtres
        if (this.pictureControl && this.pipeline && typeof this.pipeline.process === "function") {
            try {
                const result = this.pipeline.process(currentImageData, this.pictureControl);
                if (result && result.data) {
                    currentImageData = result;
                }
            } catch (err) {
                console.error("❌ Erreur durant l'exécution des filtres :", err);
            }
        }

        // 3. Dessin temporaire
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(currentImageData, 0, 0);

        // 4. Rendu final avec Zoom & Pan
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);

        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    /**
     * Exportation JPEG pleine résolution
     */
    async exportJPEG(quality = 0.92) {
        if (!this.originalRawBuffer) {
            console.error("Aucune image originale disponible pour l'exportation.");
            return null;
        }

        let fullResImageData = new ImageData(
            new Uint8ClampedArray(this.originalRawBuffer.data),
            this.originalRawBuffer.width,
            this.originalRawBuffer.height
        );

        if (this.pictureControl && this.pipeline) {
            fullResImageData = this.pipeline.process(fullResImageData, this.pictureControl);
        }

        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = fullResImageData.width;
        exportCanvas.height = fullResImageData.height;
        const ctx = exportCanvas.getContext("2d");
        ctx.putImageData(fullResImageData, 0, 0);

        return exportCanvas.toDataURL("image/jpeg", quality);
    }
}

window.imageProcessor = new ImageProcessor("previewCanvas");