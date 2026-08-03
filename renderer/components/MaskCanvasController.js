/*=========================================================
    Nikon Picture Control Studio - Mask Canvas Controller
    Gère la création ET l'édition (déplacement/redimensionnement)
    des masques par interaction souris sur le canvas du Studio.
    Coordonnées normalisées (0..1) par rapport à l'image affichée.

    LIMITE CONNUE (v1) : le pinceau ne peut pas être "déplacé" après
    coup (repasser en mode Pinceau pour ajouter des traits). Le
    linéaire et le radial supportent déplacement + redimensionnement
    du masque actuellement sélectionné.
=========================================================*/

const HIT_TOLERANCE_PX = 14; // tolérance de clic sur une poignée, en pixels canvas

class MaskCanvasController {
    constructor(imageProcessor) {
        this.imageProcessor = imageProcessor;
        this.mode = null;        // null | "linear" | "radial" | "brush"
        this.isDrawing = false;
        this.pendingMask = null;

        // Édition d'un masque existant (déplacement / redimensionnement)
        this.editState = null;   // { maskId, hit: {type}, dragStart, origGeometry }

        // Réglages du pinceau (ajustables depuis la barre d'outils)
        this.brushSize = 0.05;      // rayon, fraction de la largeur de l'image
        this.brushHardness = 0.5;   // 0 = bord très doux, 1 = bord net

        this.onMaskChange = null;   // callback(masks) appelé à chaque modification

        this._bindEvents();
    }

    startNewMask(type) {
        this.mode = type;
        this._setCursor();
    }

    cancelMode() {
        this.mode = null;
        this.isDrawing = false;
        this.pendingMask = null;
        this.editState = null;
        this._setCursor();
    }

    _setCursor(cursor) {
        const canvas = this.imageProcessor?.display?.canvas;
        if (!canvas) return;
        canvas.style.cursor = cursor || (this.mode ? "crosshair" : "grab");
    }

    /**
     * Convertit une position souris (coordonnées écran) en coordonnées
     * normalisées (0..1) dans le repère de l'image, en tenant compte :
     * - de la mise à l'échelle CSS du canvas (résolution interne vs taille affichée)
     * - du zoom et du pan actuels
     */
    _canvasToNormalized(clientX, clientY) {
        const canvas = this.imageProcessor.display.canvas;
        const rect = canvas.getBoundingClientRect();

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const xOnCanvas = ((clientX - rect.left) * scaleX - this.imageProcessor.panX) / this.imageProcessor.zoom;
        const yOnCanvas = ((clientY - rect.top) * scaleY - this.imageProcessor.panY) / this.imageProcessor.zoom;

        return {
            x: Math.min(1, Math.max(0, xOnCanvas / canvas.width)),
            y: Math.min(1, Math.max(0, yOnCanvas / canvas.height))
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

    /**
     * Teste si une position souris tombe sur une poignée du masque donné.
     * Retourne { type } ou null. Types possibles :
     *   radial : "move" (centre) | "resize" (bord de l'ellipse)
     *   linear : "point-a" | "point-b" | "move" (sur la ligne)
     */
    _hitTest(mask, clientX, clientY) {
        const canvas = this.imageProcessor.display.canvas;
        const pos = this._canvasToNormalized(clientX, clientY);
        const w = canvas.width, h = canvas.height;

        if (mask.type === "radial") {
            const g = mask.geometry;
            const rx = Math.max(0.001, g.radiusX);
            const ry = Math.max(0.001, g.radiusY);
            const d = Math.sqrt(((pos.x - g.cx) / rx) ** 2 + ((pos.y - g.cy) / ry) ** 2);

            // Bande de redimensionnement : proche du bord de l'ellipse
            if (d >= 0.85 && d <= 1.2) return { type: "resize" };
            // Tout le reste de l'intérieur : déplacement (plus besoin de viser le centre)
            if (d < 0.85) return { type: "move" };
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

        return null; // pinceau : pas de poignée en v1
    }

    _applyEdit(clientX, clientY) {
        const mask = window.MasksManager.getMask(this.editState.maskId);
        if (!mask) return;
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

    /**
     * Utilisé par ImageProcessor AVANT de démarrer un pan, pour savoir si
     * ce mousedown doit plutôt être intercepté par l'édition de masque
     * (outil de création actif, ou clic sur une poignée du masque actif).
     */
    shouldInterceptMouseEvent(clientX, clientY) {
        if (this.mode) return true;
        const activeMask = window.MasksManager?.getActiveMask?.();
        if (activeMask && this._hitTest(activeMask, clientX, clientY)) return true;
        return false;
    }

    _bindEvents() {
        const canvas = this.imageProcessor?.display?.canvas;
        if (!canvas) return;

        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;

            // CAS 1 : un outil de création est actif -> tracer un nouveau masque
            if (this.mode) {
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

            // CAS 2 : pas d'outil actif -> tester si on clique sur une poignée
            // du masque actuellement sélectionné, pour le déplacer/redimensionner
            const activeMask = window.MasksManager.getActiveMask();
            if (activeMask) {
                const hit = this._hitTest(activeMask, e.clientX, e.clientY);
                if (hit) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.MasksManager.beginAction(); // un seul point d'annulation pour tout le glisser
                    this.editState = { maskId: activeMask.id, hit, dragStart: null, origGeometry: null };
                    this._setCursor(this._cursorForHit(hit));
                    return;
                }
            }

            // CAS 3 : clic dans le vide -> laisse le pan normal de la photo s'exécuter
        });

        canvas.addEventListener("mousemove", (e) => {
            // Édition d'un masque existant (déplacement / redimensionnement)
            if (this.editState) {
                e.preventDefault();
                this._applyEdit(e.clientX, e.clientY);
                this._notify();
                this._renderOverlayOnly();
                return;
            }

            // Tracé d'un nouveau masque
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
                    const strokes = mask.geometry.strokes;
                    strokes[strokes.length - 1].push({
                        x: pos.x, y: pos.y, radius: this.brushSize, hardness: this.brushHardness
                    });
                    window.MasksManager.updateMaskGeometry(this.pendingMask.id, { strokes });
                }

                this._notify();
                this._renderOverlayOnly();
                return;
            }

            // Ni édition ni tracé en cours : survol -> retour visuel du curseur
            // uniquement si un masque est sélectionné (évite un test à chaque
            // mousemove quand ce n'est pas utile)
            if (!this.mode) {
                const activeMask = window.MasksManager.getActiveMask();
                if (activeMask) {
                    const hit = this._hitTest(activeMask, e.clientX, e.clientY);
                    this._setCursor(this._cursorForHit(hit));
                } else {
                    this._setCursor("grab");
                }
            }
        });

        window.addEventListener("mouseup", () => {
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
            this.mode = null; // repasse en mode pan normal après chaque création
            this._setCursor();
            this._notify();
            this._render(); // rendu complet (effet réel du masque) une fois le tracé terminé
        });
    }

    /**
     * Rendu léger : ne redessine que le contour vectoriel (rapide),
     * utilisé pendant le glisser pour rester fluide sur les grandes images.
     */
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
        if (typeof this.onMaskChange === "function") {
            this.onMaskChange(window.MasksManager.getMasks());
        }
    }
}

if (typeof window !== "undefined") {
    window.MaskCanvasController = MaskCanvasController;
}
