/*=========================================================
    Nikon Picture Control Studio - Image Processor (Fix Overlay)
=========================================================*/

class ImageProcessor {

    constructor(canvasId) {
        this.buffer = new ImageBuffer();
        this.originalRawBuffer = null;
        this.previewBuffer = null;
        this.loadedImage = null;
        this.currentOrientation = 1;
        this.currentLensInfo = null;
        this.display = new DisplayCanvas(canvasId);

        this.overlayCanvas = document.getElementById("maskOverlayCanvas");
        this.overlayCtx = this.overlayCanvas ? this.overlayCanvas.getContext("2d") : null;

        this.transform = { rotation: 0, flipH: false, flipV: false };
        this.pictureControl = null;
        this.pipeline = new RenderPipeline();

        this.enableMasks = true;
        this.maskController = null;
        this.showMaskOverlay = true;

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
        if (typeof DehazeFilter !== "undefined") this.pipeline.add(new DehazeFilter());
        if (typeof VibranceFilter !== "undefined") this.pipeline.add(new VibranceFilter());
        if (typeof SCurveFilter !== "undefined") this.pipeline.add(new SCurveFilter());
        if (typeof LensCorrectionFilter !== "undefined") this.pipeline.add(new LensCorrectionFilter());
        if (typeof VignetteFilter !== "undefined") this.pipeline.add(new VignetteFilter());
        if (typeof DenoiseFilter !== "undefined") this.pipeline.add(new DenoiseFilter());
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

    render() {
        const sourceBuffer = this.previewBuffer || this.originalRawBuffer;
        if (!sourceBuffer || !this.display) return;

        let currentImageData = new ImageData(
            new Uint8ClampedArray(sourceBuffer.data),
            sourceBuffer.width,
            sourceBuffer.height
        );

        if (this.pictureControl && this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this.pictureControl);
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

        this.display.draw(currentImageData);
        if (this.enableMasks) this.renderMaskOverlay();
    }

    /**
     * 🔹 Exporte l'image pure traitée (sans le fond ni le conteneur du DisplayCanvas)
     */
    getProcessedImageBlobUrl(quality = 0.95) {
        const sourceBuffer = this.previewBuffer || this.originalRawBuffer;
        if (!sourceBuffer) return null;

        let currentImageData = new ImageData(
            new Uint8ClampedArray(sourceBuffer.data),
            sourceBuffer.width,
            sourceBuffer.height
        );

        if (this.pictureControl && this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this.pictureControl);
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
     * 🔹 NOUVELLE MÉTHODE : Exporte en PLEINE RÉSOLUTION avec toutes les modifications
     * @param {number} quality - Qualité JPEG (0.0 à 1.0)
     * @param {string} format - Format de sortie ("image/jpeg" ou "image/png")
     * @returns {string|null} - DataURL de l'image exportée
     */
    exportFullResolution(quality = 0.95, format = "image/jpeg") {
        if (!this.originalRawBuffer) {
            console.error("❌ Pas de buffer original pour l'export full res");
            return null;
        }

        // Créer une copie des données originales en pleine résolution
        let currentImageData = new ImageData(
            new Uint8ClampedArray(this.originalRawBuffer.data),
            this.originalRawBuffer.width,
            this.originalRawBuffer.height
        );

        // Appliquer le pipeline de traitement (Picture Control, etc.)
        if (this.pictureControl && this.pipeline) {
            try {
                const result = this.pipeline.process(currentImageData, this.pictureControl);
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

        if (masksToDraw.length === 0) return;

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
            const strokes = mask.geometry.strokes || [];
            ctx.setLineDash([4 / scale, 3 / scale]);
            for (const stroke of strokes) {
                if (!stroke.length) continue;
                ctx.beginPath();
                ctx.moveTo(stroke[0].x * width, stroke[0].y * height);
                for (let i = 1; i < stroke.length; i++) {
                    ctx.lineTo(stroke[i].x * width, stroke[i].y * height);
                }
                ctx.stroke();
            }
        }

        ctx.restore();
    }
}

window.imageProcessor = new ImageProcessor("previewCanvas");