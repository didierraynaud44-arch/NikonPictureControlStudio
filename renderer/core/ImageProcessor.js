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
        this.currentLensInfo = null;
        this.display = new DisplayCanvas(canvasId);

        // Calque de contour des masques (superposé, uniquement pour le Studio)
        this.overlayCanvas = document.getElementById("maskOverlayCanvas");
        this.overlayCtx = this.overlayCanvas ? this.overlayCanvas.getContext("2d") : null;

        // 🔍 Zoom & Pan
        this.zoom = 1;
        this.minZoom = 0.5;
        this.maxZoom = 5;
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;

        // 🔄 Orientation & Rotation
        this.transform = {
            rotation: 0,   // Angle en degrés (ex: 90, -90, 12.5...)
            flipH: false,  // Miroir Horizontal
            flipV: false   // Miroir Vertical
        };

        this.pictureControl = null;
        this.pipeline = new RenderPipeline();

        // Masques locaux (Studio uniquement)
        this.enableMasks = false;
        this.maskController = null;
        this.showMaskOverlay = true;

        // ---------------------------------------------------------
        // PIPELINE PICTURE CONTROL NIKON (Ordre d'exécution)
        // ---------------------------------------------------------
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

        this.initZoomAndPanEvents();
    }

    /* --- Gestion des Transformations (Rotation & Miroir) --- */
    setTransform({ rotation, flipH, flipV }) {
        if (rotation !== undefined) this.transform.rotation = rotation;
        if (flipH !== undefined) this.transform.flipH = flipH;
        if (flipV !== undefined) this.transform.flipV = flipV;

        this.render();
    }

    resetTransform() {
        this.transform = { rotation: 0, flipH: false, flipV: false };
    }

    initZoomAndPanEvents() {
        const canvas = this.display?.canvas;
        if (!canvas) return;

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

        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (this.maskController && typeof this.maskController.shouldInterceptMouseEvent === "function"
                && this.maskController.shouldInterceptMouseEvent(e.clientX, e.clientY)) return;
            this.isDragging = true;
            this.dragStartX = e.clientX - this.panX;
            this.dragStartY = e.clientY - this.panY;
            canvas.style.cursor = "grabbing";
        });

        window.addEventListener("mousemove", (e) => {
            if (!this.isDragging) return;
            if (this.maskController && (this.maskController.isDrawing || this.maskController.editState)) return;
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

        canvas.addEventListener("dblclick", () => this.resetZoom());
        canvas.style.cursor = "grab";
    }

    resetZoom() {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.render();
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

                this.zoom = 1;
                this.panX = 0;
                this.panY = 0;
                this.resetTransform(); // Réinitialise la rotation/miroir sur la nouvelle image

                const fullCanvas = this.createRotatedCanvas(img, this.currentOrientation);
                const fullCtx = fullCanvas.getContext("2d");
                this.originalRawBuffer = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);

                const previewCanvas = this.createRotatedCanvas(img, this.currentOrientation, 1600);
                const previewCtx = previewCanvas.getContext("2d");
                this.previewBuffer = previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

                if (this.display && this.display.canvas) {
                    this.display.canvas.width = previewCanvas.width;
                    this.display.canvas.height = previewCanvas.height;
                }

                if (this.overlayCanvas) {
                    this.overlayCanvas.width = previewCanvas.width;
                    this.overlayCanvas.height = previewCanvas.height;
                }

                this.initZoomAndPanEvents();
                console.log(`✅ Image chargée (${fullCanvas.width}x${fullCanvas.height}) | Objectif: ${this.currentLensInfo.model}`);
                this.render();
                resolve(this.originalRawBuffer);
            };

            img.onerror = (err) => {
                console.error("❌ Erreur de chargement :", err);
                reject(err);
            };

            img.src = imageSrc;
        });
    }

    cleanPictureControl(pcData) {
        if (!pcData || typeof pcData !== "object") return {};

        const clean = { ...pcData };

        const parseVal = (val, defaultVal = 0) => {
            if (typeof val === "number" && !isNaN(val)) {
                return val === -128 ? 0 : val;
            }
            if (val === "Normal" || val === null || val === undefined) return defaultVal;
            const p = parseFloat(val);
            if (isNaN(p) || p === -128) return defaultVal;
            return p;
        };

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
        clean.whitePoint = clean.whitePoint === undefined || clean.whitePoint === null
            ? 255
            : parseVal(clean.whitePoint, 255);

        clean.isMonochrome = clean.isMonochrome === true || clean.baseProfile === "MONOCHROME";
        clean.monoFilter   = clean.monoFilter || "None";
        clean.monoToning   = clean.monoToning || "None";

        if (clean.isMonochrome) {
            clean.saturation = -100;
        }

        return clean;
    }

    setPictureControl(pcData) {
        this.pictureControl = this.cleanPictureControl(pcData);
        if (this.originalRawBuffer) {
            this.render();
        }
    }

    updateFilter(filterType, value) {
        if (!this.pictureControl) {
            this.pictureControl = {};
        }

        if (filterType === "monochrome") {
            this.pictureControl.isMonochrome = Boolean(value);
            if (value) {
                this.pictureControl.saturation = -100;
            } else {
                this.pictureControl.saturation = 0;
                this.pictureControl.monoFilter = "None";
                this.pictureControl.monoToning = "None";
            }
        } else if (typeof value === "boolean") {
            this.pictureControl[filterType] = value;
        } else {
            const parsed = parseFloat(value);
            this.pictureControl[filterType] = isNaN(parsed) ? value : parsed;
        }

        if (this.originalRawBuffer) {
            this.render();
        }
    }

    render() {
        const sourceBuffer = this.previewBuffer || this.originalRawBuffer;
        if (!sourceBuffer || !this.display || !this.display.canvas) return;

        const canvas = this.display.canvas;

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
                console.error("❌ Erreur pipeline :", err);
            }
        }

        // Masques locaux (Studio uniquement)
        if (this.enableMasks && typeof MaskEngine !== "undefined" && typeof MasksManager !== "undefined") {
            try {
                currentImageData = MaskEngine.applyAllMasks(currentImageData, MasksManager.getMasks(), this.pipeline);
            } catch (err) {
                console.error("❌ Erreur application des masques :", err);
            }
        }

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = currentImageData.width;
        tempCanvas.height = currentImageData.height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(currentImageData, 0, 0);

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // --- Application des Transformations (Zoom / Pan / Rotation / Miroir) ---
        ctx.save();
        
        // 1. Zoom & Pan
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);

        // 2. Rotation & Miroir autour du centre du Canvas
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        ctx.translate(centerX, centerY);
        ctx.rotate((this.transform.rotation * Math.PI) / 180);
        ctx.scale(
            this.transform.flipH ? -1 : 1,
            this.transform.flipV ? -1 : 1
        );
        ctx.translate(-centerX, -centerY);

        // 3. Dessin de l'image
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        ctx.restore();

        if (this.enableMasks) this.renderMaskOverlay();
    }

    renderMaskOverlay() {
        if (!this.overlayCtx || !this.overlayCanvas) return;
        if (typeof MasksManager === "undefined") return;

        const ctx = this.overlayCtx;
        const canvas = this.overlayCanvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!this.showMaskOverlay) return;

        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        ctx.translate(centerX, centerY);
        ctx.rotate((this.transform.rotation * Math.PI) / 180);
        ctx.scale(
            this.transform.flipH ? -1 : 1,
            this.transform.flipV ? -1 : 1
        );
        ctx.translate(-centerX, -centerY);

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

        for (const { mask, live } of masksToDraw) {
            this._drawMaskShape(ctx, canvas.width, canvas.height, mask, live);
        }

        ctx.restore();
    }

    _drawMaskShape(ctx, width, height, mask, live) {
        ctx.lineWidth = live ? 2 / this.zoom : 1.5 / this.zoom;
        ctx.strokeStyle = live ? "#ffffff" : "#5865f2";
        ctx.setLineDash(live ? [] : [6 / this.zoom, 4 / this.zoom]);

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

            ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
            [[ax, ay], [bx, by]].forEach(([px, py]) => {
                ctx.beginPath();
                ctx.moveTo(px - perpX * bandHalf, py - perpY * bandHalf);
                ctx.lineTo(px + perpX * bandHalf, py + perpY * bandHalf);
                ctx.stroke();
            });

        } else if (mask.type === "radial") {
            const g = mask.geometry;
            const cx = g.cx * width, cy = g.cy * height;
            const rx = Math.max(1, g.radiusX * width);
            const ry = Math.max(1, g.radiusY * height);
            const angleRad = (g.angle || 0) * Math.PI / 180;

            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, angleRad, 0, Math.PI * 2);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(cx, cy, 3 / this.zoom, 0, Math.PI * 2);
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();

        } else if (mask.type === "brush") {
            const strokes = mask.geometry.strokes || [];
            ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
            ctx.lineWidth = (live ? 2 : 1.5) / this.zoom;
            ctx.strokeStyle = live ? "#ffffff" : "#5865f2";
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
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

        ctx.setLineDash([]);
    }

    async exportImage(format = "image/jpeg", quality = 0.95) {
        if (!this.originalRawBuffer) return null;

        let fullResImageData = new ImageData(
            new Uint8ClampedArray(this.originalRawBuffer.data),
            this.originalRawBuffer.width,
            this.originalRawBuffer.height
        );

        if (this.pictureControl && this.pipeline) {
            fullResImageData = this.pipeline.process(fullResImageData, this.pictureControl);
        }

        if (this.enableMasks && typeof MaskEngine !== "undefined" && typeof MasksManager !== "undefined") {
            try {
                fullResImageData = MaskEngine.applyAllMasks(fullResImageData, MasksManager.getMasks(), this.pipeline);
            } catch (err) {
                console.error("❌ Erreur application des masques (export) :", err);
            }
        }

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = fullResImageData.width;
        tempCanvas.height = fullResImageData.height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(fullResImageData, 0, 0);

        // Canvas d'exportation avec application de la rotation et du miroir
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = fullResImageData.width;
        exportCanvas.height = fullResImageData.height;
        const ctx = exportCanvas.getContext("2d");

        ctx.save();
        const centerX = exportCanvas.width / 2;
        const centerY = exportCanvas.height / 2;

        ctx.translate(centerX, centerY);
        ctx.rotate((this.transform.rotation * Math.PI) / 180);
        ctx.scale(
            this.transform.flipH ? -1 : 1,
            this.transform.flipV ? -1 : 1
        );
        ctx.translate(-centerX, -centerY);

        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();

        if (format === "image/tiff") {
            return exportCanvas.toDataURL("image/png");
        }
        return exportCanvas.toDataURL(format, quality);
    }
}

// Instanciation globale
window.imageProcessor = new ImageProcessor("previewCanvas");