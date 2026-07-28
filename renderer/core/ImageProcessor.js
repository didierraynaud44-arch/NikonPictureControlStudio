/*=========================================================
    Nikon Picture Control Studio - Image Processor (avec Zoom)
=========================================================*/

class ImageProcessor {

    constructor(canvasId) {
        this.buffer = new ImageBuffer();
        this.originalRawBuffer = null;
        this.previewBuffer = null;
        this.loadedImage = null;
        this.currentOrientation = 1;
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

        // 1. MONOCHROME EN PREMIER
        this.pipeline.add(new MonochromeFilter());

        // 2. Réglages de détails et tonalités
        this.pipeline.add(new SharpenFilter());
        this.pipeline.add(new MidRangeSharpenFilter());
        this.pipeline.add(new ClarityFilter());
        this.pipeline.add(new ContrastFilter());
        this.pipeline.add(new HighlightsFilter());
        this.pipeline.add(new ShadowsFilter());
        this.pipeline.add(new SaturationFilter());

        // 3. Filtres avancés
        this.pipeline.add(new ToneCurveFilter());
        this.pipeline.add(new ColorBlenderFilter());
        this.pipeline.add(new ColorGradingFilter());

        // Initialisation des événements de la souris sur le Canvas
        this.initZoomAndPanEvents();
    }

    /**
     * Écouteurs d'événements pour la molette et le glisser-déposer
     */
    initZoomAndPanEvents() {
        const canvas = this.display?.canvas;
        if (!canvas) return;

        // 1. Zoom avec la molette
        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();

            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            const newZoom = Math.min(Math.max(this.zoom * zoomFactor, this.minZoom), this.maxZoom);

            // Ajustement du centrage sur le curseur
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
            this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
            this.zoom = newZoom;

            this.render();
        }, { passive: false });

        // 2. Déplacement à la souris (Pan)
        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return; // Clic gauche uniquement
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

        // 3. Double-clic pour réinitialiser le zoom
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
     * Crée un canvas pivoté selon la valeur d'orientation EXIF
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
     * Charge l'image et réinitialise le zoom
     */
    load(imageSrc, orientation = 1) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";

            img.onload = () => {
                this.loadedImage = img;
                this.currentOrientation = Number(orientation) || 1;

                // Reset de la position
                this.zoom = 1;
                this.panX = 0;
                this.panY = 0;

                // Buffer pleine définition
                const fullCanvas = this.createRotatedCanvas(img, this.currentOrientation);
                const fullCtx = fullCanvas.getContext("2d");
                this.originalRawBuffer = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);

                // Buffer preview (1600px max)
                const previewCanvas = this.createRotatedCanvas(img, this.currentOrientation, 1600);
                const previewCtx = previewCanvas.getContext("2d");
                this.previewBuffer = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

                if (this.display && this.display.canvas) {
                    this.display.canvas.width = previewCanvas.width;
                    this.display.canvas.height = previewCanvas.height;
                }

                // Attache les événements de zoom
                this.initZoomAndPanEvents();

                console.log(`✅ Image chargée (${fullCanvas.width}x${fullCanvas.height}) | Orientation: ${this.currentOrientation}`);
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

    cleanPictureControl(pcData) {
        if (!pcData) return {};
        
        const clean = { ...pcData };
        const parseValue = (val) => {
            if (typeof val === "number") return val;
            if (val === "Normal" || !val) return 0;
            const parsed = parseFloat(val);
            return isNaN(parsed) ? 0 : parsed;
        };

        clean.sharpening = parseValue(clean.sharpening ?? clean.sharpness ?? clean.sharpning);
        clean.midRangeSharpening = parseValue(clean.midRangeSharpening ?? clean.midRangeSharpning);
        clean.clarity = parseValue(clean.clarity);
        clean.contrast = parseValue(clean.contrast);
        clean.highlights = parseValue(clean.highlights);
        clean.shadows = parseValue(clean.shadows);
        clean.saturation = parseValue(clean.saturation);

        return clean;
    }

    setPictureControl(pcData) {
        this.pictureControl = this.cleanPictureControl(pcData);

        if (!this.originalRawBuffer) return;
        this.render();
    }

    render() {
        const sourceBuffer = this.previewBuffer || this.originalRawBuffer;
        if (!sourceBuffer || !this.display || !this.display.canvas) return;

        const canvas = this.display.canvas;

        // 1. Copie et traitement des pixels via le pipeline
        let currentImageData = new ImageData(
            new Uint8ClampedArray(sourceBuffer.data),
            sourceBuffer.width,
            sourceBuffer.height
        );

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

        // 2. Dessin dans un canvas temporaire
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(currentImageData, 0, 0);

        // 3. Application de la transformation (Zoom + Pan) sur le Canvas final
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);

        // Dessine l'image avec transformation
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

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