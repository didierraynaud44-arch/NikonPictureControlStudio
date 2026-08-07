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
        this.maxScale = 10;
        this.panX = 0;
        this.panY = 0;

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

        let zoomBar = document.getElementById("canvasZoomBar");
        if (!zoomBar) {
            zoomBar = document.createElement("div");
            zoomBar.id = "canvasZoomBar";
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

    setZoomScale(targetScale, focalX = null, focalY = null) {
        if (!this.offscreenCanvas.width || !this.canvas.width) return;

        const safeScale = Math.min(Math.max(this.minScale, targetScale), this.maxScale);

        if (focalX !== null && focalY !== null) {
            const w = this.canvas.width;
            const h = this.canvas.height;
            const imgW = this.offscreenCanvas.width;
            const imgH = this.offscreenCanvas.height;

            const oldDrawX = (w - imgW * this.scale) / 2 + this.panX;
            const oldDrawY = (h - imgH * this.scale) / 2 + this.panY;

            const imgMouseX = (focalX - oldDrawX) / this.scale;
            const imgMouseY = (focalY - oldDrawY) / this.scale;

            this.scale = safeScale;

            const newDrawX = focalX - imgMouseX * this.scale;
            const newDrawY = focalY - imgMouseY * this.scale;

            this.panX = newDrawX - (w - imgW * this.scale) / 2;
            this.panY = newDrawY - (h - imgH * this.scale) / 2;
        } else {
            this.scale = safeScale;
        }

        this.updateZoomUI();
        this.requestRender();
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
                    return;
                }
            }

            this.isDragging = true;
            this.startX = e.clientX - this.panX;
            this.startY = e.clientY - this.panY;
            this.canvas.style.cursor = "grabbing";
        });

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

    draw(imageData) {
        if (!imageData) return;

        const isNewImage = (this.offscreenCanvas.width !== imageData.width || this.offscreenCanvas.height !== imageData.height);

        this.offscreenCanvas.width = imageData.width;
        this.offscreenCanvas.height = imageData.height;
        this.offscreenCtx.putImageData(imageData, 0, 0);

        const parent = this.canvas.parentElement;
        if (parent) {
            const w = Math.floor(parent.clientWidth);
            const h = Math.floor(parent.clientHeight);
            if (w > 0 && h > 0) {
                this.canvas.width = w;
                this.canvas.height = h;
            }
        }

        if (isNewImage || !this.scale) {
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

        this.ctx.fillStyle = "#141414";
        this.ctx.fillRect(0, 0, w, h);

        this.ctx.save();

        const drawX = (w - imgW * this.scale) / 2 + this.panX;
        const drawY = (h - imgH * this.scale) / 2 + this.panY;

        this.ctx.translate(drawX, drawY);
        this.ctx.scale(this.scale, this.scale);

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
        const imgW = this.offscreenCanvas.width;
        const imgH = this.offscreenCanvas.height;

        this.scale = Math.min(containerW / imgW, containerH / imgH) * 0.95;
        this.panX = 0;
        this.panY = 0;

        this.updateZoomUI();
        this.requestRender();
    }

    resize(w, h) {
        if (this.offscreenCanvas.width > 0) {
            this.requestRender();
        }
    }
}

window.DisplayCanvas = DisplayCanvas;