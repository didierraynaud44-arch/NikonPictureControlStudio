/*=========================================================
    Pixel RAW - Monochrome Mask Canvas Controller
    Gomme LOCALE du module Monochrome : un seul mode "erase", peint une
    géométrie de pinceau (même format que les masques : {strokes: [[{x,y,
    radius,hardness}, ...]]}) — mais PAS une géométrie unique : this.currentTarget
    sélectionne laquelle des 10 cibles indépendantes de MonochromeManager
    (8 canaux du mixeur + Dodge & Burn + Punch) reçoit les traits peints. Peindre
    réduit localement l'INTENSITÉ du réglage ciblé (voir ImageProcessor.
    _injectMonoLocalMultipliers) — l'image reste N&B partout, aucune couleur
    n'est jamais révélée. Structure directement inspirée de
    RetouchCanvasController.js (même écoute souris sur window, même
    _canvasToNormalized) — pas de notion de point source, un seul outil.

    Encapsulé en IIFE : MaskCanvasController.js et RetouchCanvasController.js
    ne le sont PAS et déclarent chacun des identifiants au niveau racine du
    script (const HIT_TOLERANCE_PX, class MaskCanvasController/
    RetouchCanvasController) — sans IIFE ici, tout identifiant de même nom
    provoquerait une SyntaxError de redéclaration au chargement de la page
    (script classique, portée de script partagée), cassant silencieusement
    le chargement de TOUS les scripts suivants. Isolé ici pour ne rien
    ajouter à cette portée partagée hormis window.MonochromeMaskCanvasController.
=========================================================*/

(function () {

class MonochromeMaskCanvasController {
    constructor(imageProcessor) {
        this.imageProcessor = imageProcessor;
        this.mode = null; // null | "erase"

        // Cible actuellement peinte : l'une des 10 clés de MonochromeManager.
        // ERASE_TARGETS, choisie via le menu déroulant du panneau. Changer de
        // cible entre deux traits permet de peindre indépendamment sur chaque
        // réglage, sur la même photo.
        this.currentTarget = "red";

        this.brushSize = 0.05;
        this.brushHardness = 0.5;

        this.isDrawing = false;
        this.hoverPos = null; // aperçu du cercle de pinceau (survol ET tracé en cours)

        this.onEraseChange = null;

        this._boundMouseDown = null;
        this._boundMouseMove = null;
        this._boundMouseUp = null;

        this._bindEvents();
    }

    startTool() {
        this.mode = "erase";
        this.isDrawing = false;
        this.hoverPos = null;
        this._setCursor("crosshair");
    }

    cancelMode() {
        this.mode = null;
        this.isDrawing = false;
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
        // Nettoyage des anciens écouteurs pour éviter les doublons (même
        // précaution que MaskCanvasController/RetouchCanvasController).
        if (this._boundMouseDown) window.removeEventListener("mousedown", this._boundMouseDown, true);
        if (this._boundMouseMove) window.removeEventListener("mousemove", this._boundMouseMove);
        if (this._boundMouseUp) window.removeEventListener("mouseup", this._boundMouseUp);

        this._boundMouseDown = (e) => {
            if (e.button !== 0) return;
            if (this.mode !== "erase") return;
            if (typeof window.MonochromeManager === "undefined") return;

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
            this.isDrawing = true;
            this.hoverPos = pos;

            window.MonochromeManager.startEraseStroke(this.currentTarget, {
                x: pos.x, y: pos.y, radius: this.brushSize, hardness: this.brushHardness
            });

            this._renderOverlayOnly();
        };

        this._boundMouseMove = (e) => {
            if (this.isDrawing) {
                e.preventDefault();
                const pos = this._canvasToNormalized(e.clientX, e.clientY);
                this.hoverPos = pos;

                if (window.MonochromeManager) {
                    window.MonochromeManager.appendErasePoint(this.currentTarget, {
                        x: pos.x, y: pos.y, radius: this.brushSize, hardness: this.brushHardness
                    });
                }

                // Comme pour le pinceau de masque/le Tampon : seul le cercle de
                // pinceau suit la souris en temps réel pendant le tracé (rendu
                // léger). L'effet réel (recalcul des cartes de multiplicateur
                // local, qui relance tout le pipeline) n'est recalculé qu'au
                // relâchement, pour rester fluide même sur un tracé rapide.
                this._renderOverlayOnly();
                return;
            }

            if (this.mode === "erase") {
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

    /**
     * Rendu complet (relance tout le pipeline, y compris le recalcul des
     * cartes de multiplicateur local de la Gomme locale) — appelé seulement
     * au relâchement, voir _bindEvents().
     */
    _render() {
        if (this.imageProcessor && typeof this.imageProcessor.render === "function") {
            this.imageProcessor.render();
        }
    }

    _notify() {
        if (typeof this.onEraseChange === "function" && window.MonochromeManager) {
            this.onEraseChange(window.MonochromeManager.getEraseGeometry(this.currentTarget));
        }
    }
}

if (typeof window !== "undefined") {
    window.MonochromeMaskCanvasController = MonochromeMaskCanvasController;
}

})();
