/*=========================================================
    Pixel RAW - Perspective Canvas Controller
    4 poignées aux coins de l'image, positionnées par l'utilisateur sur les
    bords d'un élément qui devrait être rectangulaire dans la réalité — même
    famille d'interaction que CropCanvasController/MaskCanvasController.

    🔹 Contrairement à CropCanvasController, PAS de bascule "rotation gravée +
    cosmétique supprimée" : la perspective s'applique AVANT le bake rotation
    dans le pipeline (voir plan), donc les coins restent normalisés dans le
    MÊME référentiel que les masques/retouches (image non tournée). Même
    limitation déjà acceptée pour ceux-ci : _canvasToNormalized n'est PAS
    conscient de la rotation cosmétique de DisplayCanvas — si "Angle fin" est
    non nul pendant l'édition de la perspective, l'overlay peut être
    légèrement désaligné visuellement (existant, pas une régression).
=========================================================*/

const PERSPECTIVE_HANDLE_TOLERANCE_PX = 28;
const PERSPECTIVE_CORNER_IDS = ["tl", "tr", "bl", "br"];
const PERSPECTIVE_CORNER_INDEX = { tl: 0, tr: 1, bl: 2, br: 3 };

class PerspectiveCanvasController {
    constructor(imageProcessor) {
        this.imageProcessor = imageProcessor;
        this.dragHandle = null; // null | "tl" | "tr" | "bl" | "br"
        this.onPerspectiveChange = null;

        this._boundMouseDown = null;
        this._boundMouseMove = null;
        this._boundMouseUp = null;

        this._bindEvents();
    }

    _ensurePerspectiveSettings() {
        const ip = this.imageProcessor;
        if (!ip.perspectiveSettings) {
            ip.perspectiveSettings = {
                enabled: true,
                corners: [
                    { x: 0, y: 0 }, { x: 1, y: 0 },
                    { x: 0, y: 1 }, { x: 1, y: 1 }
                ]
            };
        }
        return ip.perspectiveSettings;
    }

    reset() {
        this.imageProcessor.perspectiveSettings = {
            enabled: true,
            corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
        };
        this._notify();
        this._render();
    }

    // ---------------------------------------------------------------
    // Interaction souris (calqué sur MaskCanvasController._canvasToNormalized)
    // ---------------------------------------------------------------

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

        return { x: imgX / imgW, y: imgY / imgH };
    }

    _hitTestHandle(clientX, clientY) {
        const ip = this.imageProcessor;
        const persp = ip.perspectiveSettings;
        if (!persp) return null;
        const display = ip.display;
        if (!display || !display.offscreenCanvas.width) return null;

        const pos = this._canvasToNormalized(clientX, clientY);
        const imgW = display.offscreenCanvas.width;
        const imgH = display.offscreenCanvas.height;
        const scale = display.scale || 1;
        const tol = PERSPECTIVE_HANDLE_TOLERANCE_PX / scale;

        const px = pos.x * imgW, py = pos.y * imgH;
        for (let i = 0; i < 4; i++) {
            const c = persp.corners[i];
            const hx = c.x * imgW, hy = c.y * imgH;
            if (Math.hypot(px - hx, py - hy) <= tol) return PERSPECTIVE_CORNER_IDS[i];
        }
        return null;
    }

    _setCursor(hit) {
        const canvas = this.imageProcessor?.display?.canvas;
        if (!canvas) return;
        canvas.style.cursor = hit ? "crosshair" : "default";
    }

    _bindEvents() {
        if (this._boundMouseDown) window.removeEventListener("mousedown", this._boundMouseDown, true);
        if (this._boundMouseMove) window.removeEventListener("mousemove", this._boundMouseMove);
        if (this._boundMouseUp) window.removeEventListener("mouseup", this._boundMouseUp);

        this._boundMouseDown = (e) => {
            if (e.button !== 0) return;
            if (!this.imageProcessor.perspectivePanelActive) return;

            const canvas = this.imageProcessor?.display?.canvas;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const insideCanvas = (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            );
            if (!insideCanvas) return;

            this._ensurePerspectiveSettings();
            const hit = this._hitTestHandle(e.clientX, e.clientY);
            if (!hit) return;

            e.preventDefault();
            e.stopPropagation();

            this.dragHandle = hit;
            this._setCursor(hit);
        };

        this._boundMouseMove = (e) => {
            if (!this.dragHandle) {
                if (this.imageProcessor.perspectivePanelActive) {
                    this._setCursor(this._hitTestHandle(e.clientX, e.clientY));
                }
                return;
            }

            e.preventDefault();
            const pos = this._canvasToNormalized(e.clientX, e.clientY);
            const idx = PERSPECTIVE_CORNER_INDEX[this.dragHandle];
            this.imageProcessor.perspectiveSettings.corners[idx] = {
                x: Math.min(1, Math.max(0, pos.x)),
                y: Math.min(1, Math.max(0, pos.y))
            };

            // 🔹 Aperçu en direct de la déformation (pas juste la poignée) :
            // rendu complet à chaque mousemove, la perspective fait partie
            // du pipeline normal dès qu'elle est activée (voir ImageProcessor.render()).
            this._render();
        };

        this._boundMouseUp = () => {
            if (!this.dragHandle) return;
            this.dragHandle = null;
            this._setCursor(null);
            this._notify();
            this._render();
        };

        window.addEventListener("mousedown", this._boundMouseDown, true);
        window.addEventListener("mousemove", this._boundMouseMove);
        window.addEventListener("mouseup", this._boundMouseUp);
    }

    _render() {
        if (this.imageProcessor && typeof this.imageProcessor.render === "function") {
            this.imageProcessor.render();
        }
    }

    _notify() {
        if (typeof this.onPerspectiveChange === "function") {
            this.onPerspectiveChange(this.imageProcessor.perspectiveSettings);
        }
    }
}

if (typeof window !== "undefined") {
    window.PerspectiveCanvasController = PerspectiveCanvasController;
}
