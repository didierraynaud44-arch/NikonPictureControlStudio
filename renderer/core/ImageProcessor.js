class ImageProcessor {

    constructor(canvasId) {
        this.buffer = new ImageBuffer();
        this.originalRawBuffer = null;
        this.previewBuffer = null;
        this.loadedImage = null;
        this.display = new DisplayCanvas(canvasId);

        this.pictureControl = null;
        this.pipeline = new RenderPipeline();
// 1. 🎯 MONOCHROME EN PREMIER
// Si le profil est "Monochrome", il convertit les pixels en N&B selon le filtre optique
this.pipeline.add(new MonochromeFilter());
        // 🎯 Activation du pipeline de filtres (aligné avec les sliders de l'IHM)
        this.pipeline.add(new SharpenFilter());
        this.pipeline.add(new MidRangeSharpenFilter());
        this.pipeline.add(new ClarityFilter()); // 👈 Ajouté ici !
        this.pipeline.add(new ContrastFilter());
        this.pipeline.add(new HighlightsFilter());
        this.pipeline.add(new ShadowsFilter());
        this.pipeline.add(new SaturationFilter());

        // Filtres avancés (pour les courbes / profils couleur si présents dans le NP3)
        this.pipeline.add(new ToneCurveFilter());
        this.pipeline.add(new ColorBlenderFilter());
		this.pipeline.add(new ColorGradingFilter()); // 👈 Désormais activé
    }

    load(imageSrc) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";

            img.onload = () => {
                this.loadedImage = img;

                // 1. Buffer d'origine pleine résolution
                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                const ctx = tempCanvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                this.originalRawBuffer = ctx.getImageData(0, 0, img.width, img.height);

                // 2. Buffer de prévisualisation (max 1600px pour des filtres fluides)
                const maxDimension = 1600;
                let previewWidth = img.width;
                let previewHeight = img.height;

                if (previewWidth > maxDimension) {
                    previewHeight = Math.round((maxDimension / previewWidth) * previewHeight);
                    previewWidth = maxDimension;
                }

                const previewCanvas = document.createElement("canvas");
                previewCanvas.width = previewWidth;
                previewCanvas.height = previewHeight;
                const previewCtx = previewCanvas.getContext("2d");
                previewCtx.drawImage(img, 0, 0, previewWidth, previewHeight);

                this.previewBuffer = previewCtx.getImageData(0, 0, previewWidth, previewHeight);

                // 3. Initialisation du canvas d'affichage principal
                if (this.display && this.display.canvas) {
                    this.display.canvas.width = img.width;
                    this.display.canvas.height = img.height;

                    const displayCtx = this.display.canvas.getContext("2d");
                    displayCtx.drawImage(img, 0, 0);
                }

                console.log(`✅ Image chargée (${img.width}x${img.height}) | Preview : (${previewWidth}x${previewHeight})`);
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

        // 1. Copie des pixels pour le traitement
        let currentImageData = new ImageData(
            new Uint8ClampedArray(sourceBuffer.data),
            sourceBuffer.width,
            sourceBuffer.height
        );

        // 2. Exécution de la chaîne de filtres
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

        // 3. Dessin du buffer filtré sur le canvas principal
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(currentImageData, 0, 0);

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    }async exportJPEG(quality = 0.92) {
    if (!this.originalRawBuffer) {
        console.error("Aucune image originale disponible pour l'exportation.");
        return null;
    }

    // 1. Calcul du pipeline sur le buffer pleine définition
    let fullResImageData = new ImageData(
        new Uint8ClampedArray(this.originalRawBuffer.data),
        this.originalRawBuffer.width,
        this.originalRawBuffer.height
    );

    if (this.pictureControl && this.pipeline) {
        fullResImageData = this.pipeline.process(fullResImageData, this.pictureControl);
    }

    // 2. Rendu sur un canvas temporaire hors-écran à taille réelle
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = fullResImageData.width;
    exportCanvas.height = fullResImageData.height;
    const ctx = exportCanvas.getContext("2d");
    ctx.putImageData(fullResImageData, 0, 0);

    // 3. Conversion en DataURL JPEG
    return exportCanvas.toDataURL("image/jpeg", quality);
}
}

window.imageProcessor = new ImageProcessor("previewCanvas");