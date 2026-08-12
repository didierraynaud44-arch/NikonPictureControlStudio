/*=========================================================
    Pixel RAW - Retouch Canvas Controller
    Interaction façon tampon de duplication : Alt+clic (ou Ctrl+clic) fixe
    le point source, puis un glissé peint la zone de destination à corriger.
=========================================================*/

class RetouchCanvasController {
    constructor(imageProcessor) {
        this.imageProcessor = imageProcessor;
        this.mode = null; // null | "heal"

        this.brushSize = 0.05;
        this.brushHardness = 0.5;

        this.sourcePoint = null;   // {x,y} normalisé : dernier point défini par Alt/Ctrl+clic
        this.lockedOffset = null;  // {dx,dy} normalisé : décalage figé pour le(s) trait(s) en cours ("aligné", comme Photoshop)

        this.isDrawing = false;
        this.pendingStroke = null;
        this.hoverPos = null; // aperçu du cercle de pinceau au survol, avant tout tracé

        this.onRetouchChange = null;

        this._boundMouseDown = null;
        this._boundMouseMove = null;
        this._boundMouseUp = null;

        this._bindEvents();
    }

    startTool() {
        this.mode = "heal";
        this.isDrawing = false;
        this.pendingStroke = null;
        this.hoverPos = null;
        this._setCursor("crosshair");
    }

    cancelMode() {
        this.mode = null;
        this.isDrawing = false;
        this.pendingStroke = null;
        this.hoverPos = null;
        this._setCursor();
        this._renderOverlayOnly();
    }

    _setCursor(cursor) {
        const canvas = this.imageProcessor?.display?.canvas;
        if (!canvas) return;
        canvas.style.cursor = cursor || (this.mode ? "crosshair" : "grab");
    }

    _canvasToNormalized(clientX, clientY) {
        const display = this.imageProcessor?.display;
        if (!display || !display.canvas || !display.offscreenCanvas.width) {
            return { x: 0.5, y: 0.5 };
        }

        const canvas = display.canvas;
        const rect = canvas.getBoundingClientRect();

        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        const cssScaleX = canvas.width / rect.width;
        const cssScaleY = canvas.height / rect.height;

        const canvasX = mouseX * cssScaleX;
        const canvasY = mouseY * cssScaleY;

        const w = canvas.width;
        const h = canvas.height;
        const imgW = display.offscreenCanvas.width;
        const imgH = display.offscreenCanvas.height;
        const scale = display.scale || 1;
        const panX = display.panX || 0;
        const panY = display.panY || 0;

        const drawX = (w - imgW * scale) / 2 + panX;
        const drawY = (h - imgH * scale) / 2 + panY;

        const imgX = (canvasX - drawX) / scale;
        const imgY = (canvasY - drawY) / scale;

        return {
            x: Math.min(1, Math.max(0, imgX / imgW)),
            y: Math.min(1, Math.max(0, imgY / imgH))
        };
    }

    _bindEvents() {
        if (this._boundMouseDown) window.removeEventListener("mousedown", this._boundMouseDown, true);
        if (this._boundMouseMove) window.removeEventListener("mousemove", this._boundMouseMove);
        if (this._boundMouseUp) window.removeEventListener("mouseup", this._boundMouseUp);

        this._boundMouseDown = (e) => {
            if (e.button !== 0) return;
            if (this.mode !== "heal") return;

            const canvas = this.imageProcessor?.display?.canvas;
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            const insideCanvas = (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            );
            if (!insideCanvas) return;

            e.preventDefault();
            e.stopPropagation();

            const pos = this._canvasToNormalized(e.clientX, e.clientY);

            if (e.altKey || e.ctrlKey) {
                this.sourcePoint = pos;
                this.lockedOffset = null; // le prochain trait recalcule le décalage depuis ce nouveau point
                this._renderOverlayOnly();
                return;
            }

            if (!this.sourcePoint) return; // pas de source définie : ignore le tracé

            if (!this.lockedOffset) {
                this.lockedOffset = {
                    dx: this.sourcePoint.x - pos.x,
                    dy: this.sourcePoint.y - pos.y
                };
            }

            this.isDrawing = true;
            this.pendingStroke = [{ x: pos.x, y: pos.y, radius: this.brushSize, hardness: this.brushHardness }];

            this._renderOverlayOnly();
        };

        this._boundMouseMove = (e) => {
            if (this.isDrawing && this.pendingStroke) {
                e.preventDefault();
                const pos = this._canvasToNormalized(e.clientX, e.clientY);
                this.pendingStroke.push({ x: pos.x, y: pos.y, radius: this.brushSize, hardness: this.brushHardness });
                this._renderOverlayOnly();
                return;
            }

            if (this.mode === "heal") {
                const canvas = this.imageProcessor?.display?.canvas;
                const rect = canvas ? canvas.getBoundingClientRect() : null;
                const insideCanvas = rect && (
                    e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom
                );
                this.hoverPos = insideCanvas ? this._canvasToNormalized(e.clientX, e.clientY) : null;
                this._renderOverlayOnly();
            }
        };

        this._boundMouseUp = () => {
            if (!this.isDrawing) return;
            this.isDrawing = false;

            if (this.pendingStroke && this.pendingStroke.length > 0 && this.lockedOffset && window.RetouchManager) {
                window.RetouchManager.createRetouch(
                    "heal",
                    { strokes: [this.pendingStroke] },
                    { ...this.lockedOffset }
                );
                this._notify();
            }

            this.pendingStroke = null;
            this._render();
        };

        window.addEventListener("mousedown", this._boundMouseDown, true);
        window.addEventListener("mousemove", this._boundMouseMove);
        window.addEventListener("mouseup", this._boundMouseUp);
    }

    _renderOverlayOnly() {
        if (this.imageProcessor && typeof this.imageProcessor.renderMaskOverlay === "function") {
            this.imageProcessor.renderMaskOverlay();
        }
    }

    _render() {
        if (this.imageProcessor && typeof this.imageProcessor.render === "function") {
            this.imageProcessor.render();
        }
    }

    _notify() {
        if (typeof this.onRetouchChange === "function" && window.RetouchManager) {
            this.onRetouchChange(window.RetouchManager.getRetouches());
        }
    }
}

if (typeof window !== "undefined") {
    window.RetouchCanvasController = RetouchCanvasController;
}
