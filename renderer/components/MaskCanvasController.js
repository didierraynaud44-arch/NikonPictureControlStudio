/*=========================================================
    Nikon Picture Control Studio - Mask Canvas Controller
=========================================================*/

const HIT_TOLERANCE_PX = 24;

class MaskCanvasController {
    constructor(imageProcessor) {
        this.imageProcessor = imageProcessor;
        this.mode = null;        // null | "linear" | "radial" | "brush"
        this.isDrawing = false;
        this.pendingMask = null;
        this.editState = null;

        this.brushSize = 0.05;
        this.brushHardness = 0.5;
        this.brushPreviewPos = null; // {x,y} normalisé (0-1) : dernière position survolée en mode pinceau
        this.onMaskChange = null;

        this._boundMouseDown = null;
        this._boundMouseMove = null;
        this._boundMouseUp = null;

        this._bindEvents();
    }

    startNewMask(type) {
        this.mode = type;
        this.isDrawing = false;
        this.pendingMask = null;
        this.brushPreviewPos = null;
        this._setCursor("crosshair");
    }

    cancelMode() {
        this.mode = null;
        this.isDrawing = false;
        this.pendingMask = null;
        this.editState = null;
        this.brushPreviewPos = null;
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

    _pointToSegmentDistance(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy || 1e-6;
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        return Math.hypot(px - cx, py - cy);
    }

    _hitTest(mask, clientX, clientY) {
        const display = this.imageProcessor?.display;
        if (!display || !display.offscreenCanvas.width) return null;

        const pos = this._canvasToNormalized(clientX, clientY);
        const w = display.offscreenCanvas.width;
        const h = display.offscreenCanvas.height;

        if (mask.type === "radial") {
            const g = mask.geometry;
            const rx = Math.max(0.001, g.radiusX);
            const ry = Math.max(0.001, g.radiusY);
            const d = Math.sqrt(((pos.x - g.cx) / rx) ** 2 + ((pos.y - g.cy) / ry) ** 2);

            if (d >= 0.75 && d <= 1.25) return { type: "resize" };
            if (d < 0.75) return { type: "move" };
            return null;
        }

        if (mask.type === "linear") {
            const g = mask.geometry;
            const distA = Math.hypot((pos.x - g.x1) * w, (pos.y - g.y1) * h);
            const distB = Math.hypot((pos.x - g.x2) * w, (pos.y - g.y2) * h);
            if (distA <= HIT_TOLERANCE_PX) return { type: "point-a" };
            if (distB <= HIT_TOLERANCE_PX) return { type: "point-b" };

            const ax = g.x1 * w, ay = g.y1 * h;
            const bx = g.x2 * w, by = g.y2 * h;
            const px = pos.x * w, py = pos.y * h;
            const distToLine = this._pointToSegmentDistance(px, py, ax, ay, bx, by);
            if (distToLine <= HIT_TOLERANCE_PX * 1.5) return { type: "move" };
            return null;
        }

        return null;
    }

    _applyEdit(clientX, clientY) {
        const mask = window.MasksManager?.getActiveMask?.();
        if (!mask || !this.editState) return;
        const pos = this._canvasToNormalized(clientX, clientY);
        const hit = this.editState.hit;

        if (mask.type === "radial") {
            if (hit.type === "move") {
                window.MasksManager.updateMaskGeometry(mask.id, { cx: pos.x, cy: pos.y });
            } else if (hit.type === "resize") {
                const dx = pos.x - mask.geometry.cx;
                const dy = pos.y - mask.geometry.cy;
                const r = Math.max(0.01, Math.hypot(dx, dy));
                window.MasksManager.updateMaskGeometry(mask.id, { radiusX: r, radiusY: r });
            }
        } else if (mask.type === "linear") {
            if (hit.type === "point-a") {
                window.MasksManager.updateMaskGeometry(mask.id, { x1: pos.x, y1: pos.y });
            } else if (hit.type === "point-b") {
                window.MasksManager.updateMaskGeometry(mask.id, { x2: pos.x, y2: pos.y });
            } else if (hit.type === "move") {
                if (!this.editState.dragStart) {
                    this.editState.dragStart = pos;
                    this.editState.origGeometry = { ...mask.geometry };
                }
                const dx = pos.x - this.editState.dragStart.x;
                const dy = pos.y - this.editState.dragStart.y;
                window.MasksManager.updateMaskGeometry(mask.id, {
                    x1: this.editState.origGeometry.x1 + dx,
                    y1: this.editState.origGeometry.y1 + dy,
                    x2: this.editState.origGeometry.x2 + dx,
                    y2: this.editState.origGeometry.y2 + dy
                });
            }
        }
    }

    _cursorForHit(hit) {
        if (!hit) return "grab";
        if (hit.type === "move") return "move";
        if (hit.type === "resize") return "nwse-resize";
        if (hit.type === "point-a" || hit.type === "point-b") return "crosshair";
        return "grab";
    }

    shouldInterceptMouseEvent(clientX, clientY) {
        if (this.mode) return true;
        const activeMask = window.MasksManager?.getActiveMask?.();
        if (activeMask && this._hitTest(activeMask, clientX, clientY)) return true;
        return false;
    }

    _bindEvents() {
        // Nettoyage des anciens écouteurs pour éviter les doublons
        if (this._boundMouseDown) window.removeEventListener("mousedown", this._boundMouseDown, true);
        if (this._boundMouseMove) window.removeEventListener("mousemove", this._boundMouseMove);
        if (this._boundMouseUp) window.removeEventListener("mouseup", this._boundMouseUp);

        this._boundMouseDown = (e) => {
            if (e.button !== 0) return;

            const canvas = this.imageProcessor?.display?.canvas;
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            const insideCanvas = (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            );

            if (this.mode && insideCanvas) {
                e.preventDefault();
                e.stopPropagation();

                const pos = this._canvasToNormalized(e.clientX, e.clientY);
                this.isDrawing = true;

                if (this.mode === "linear") {
                    this.pendingMask = window.MasksManager.createMask("linear", {
                        x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, feather: 1, invert: false
                    });
                } else if (this.mode === "radial") {
                    this.pendingMask = window.MasksManager.createMask("radial", {
                        cx: pos.x, cy: pos.y, radiusX: 0.01, radiusY: 0.01,
                        angle: 0, feather: 0.5, invert: false
                    });
                } else if (this.mode === "brush") {
                    this.pendingMask = window.MasksManager.createMask("brush", {
                        strokes: [[{ x: pos.x, y: pos.y, radius: this.brushSize, hardness: this.brushHardness }]],
                        invert: false
                    });
                }

                this._notify();
                this._renderOverlayOnly();
                return;
            }

            const activeMask = window.MasksManager?.getActiveMask?.();
            if (activeMask && insideCanvas) {
                const hit = this._hitTest(activeMask, e.clientX, e.clientY);
                if (hit) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.MasksManager.beginAction();
                    this.editState = { maskId: activeMask.id, hit, dragStart: null, origGeometry: null };
                    this._setCursor(this._cursorForHit(hit));
                    return;
                }
            }
        };

        this._boundMouseMove = (e) => {
            if (this.editState) {
                e.preventDefault();
                this._applyEdit(e.clientX, e.clientY);
                this._notify();
                this._renderOverlayOnly();
                return;
            }

            if (this.isDrawing && this.pendingMask) {
                e.preventDefault();
                const pos = this._canvasToNormalized(e.clientX, e.clientY);

                if (this.pendingMask.type === "linear") {
                    window.MasksManager.updateMaskGeometry(this.pendingMask.id, { x2: pos.x, y2: pos.y });
                } else if (this.pendingMask.type === "radial") {
                    const dx = pos.x - this.pendingMask.geometry.cx;
                    const dy = pos.y - this.pendingMask.geometry.cy;
                    const r = Math.max(0.01, Math.hypot(dx, dy));
                    window.MasksManager.updateMaskGeometry(this.pendingMask.id, { radiusX: r, radiusY: r });
                } else if (this.pendingMask.type === "brush") {
                    const mask = window.MasksManager.getMask(this.pendingMask.id);
                    if (mask && mask.geometry.strokes) {
                        const strokes = mask.geometry.strokes;
                        strokes[strokes.length - 1].push({
                            x: pos.x, y: pos.y, radius: this.brushSize, hardness: this.brushHardness
                        });
                        window.MasksManager.updateMaskGeometry(this.pendingMask.id, { strokes });
                    }
                }

                this._notify();
                this._renderOverlayOnly();
                return;
            }

            if (!this.mode) {
                const activeMask = window.MasksManager?.getActiveMask?.();
                if (activeMask) {
                    const hit = this._hitTest(activeMask, e.clientX, e.clientY);
                    this._setCursor(this._cursorForHit(hit));
                }
            }

            // Aperçu du cercle de pinceau : dès que l'outil Pinceau est actif, avant
            // même le premier clic (survol seul), pour que la taille choisie soit
            // visible directement sur la photo.
            if (this.mode === "brush") {
                const canvas = this.imageProcessor?.display?.canvas;
                const rect = canvas ? canvas.getBoundingClientRect() : null;
                const insideCanvas = rect && (
                    e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom
                );

                this.brushPreviewPos = insideCanvas ? this._canvasToNormalized(e.clientX, e.clientY) : null;
                this._renderOverlayOnly();
            }
        };

        this._boundMouseUp = () => {
            if (this.editState) {
                this.editState = null;
                this._setCursor();
                this._notify();
                this._render();
                return;
            }

            if (!this.isDrawing) return;
            this.isDrawing = false;
            this.pendingMask = null;
            this.mode = null;
            this._setCursor();
            this._notify();
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
        if (typeof this.onMaskChange === "function" && window.MasksManager) {
            this.onMaskChange(window.MasksManager.getMasks());
        }
    }
}

if (typeof window !== "undefined") {
    window.MaskCanvasController = MaskCanvasController;
}