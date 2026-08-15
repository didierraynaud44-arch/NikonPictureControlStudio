/*=========================================================
    Pixel RAW - Crop Canvas Controller (Recadrage + Niveau)

    Cadre de recadrage à 8 poignées, ratios fixes optionnels, contraint
    automatiquement au plus grand rectangle inscriptible dans l'image tournée
    (voir Angle fin / _largestInscribedRect, formule vérifiée par recherche
    externe avant implémentation).

    Même schéma d'interaction que MaskCanvasController.js/RetouchCanvasController.js
    (écouteurs window-level, _canvasToNormalized pan/zoom-aware). PAS de maths
    de rotation ici volontairement : pendant l'édition du panneau Recadrage,
    ImageProcessor.render() grave la rotation dans les pixels et supprime la
    rotation cosmétique de DisplayCanvas (voir cropPanelActive) — l'image
    affichée est donc déjà axis-aligned, comme pour l'édition de masques.

    cropSettings ({enabled, ratioId, rectX, rectY, rectWidth, rectHeight},
    coords normalisées RELATIVES À L'IMAGE TOURNÉE) vit directement sur
    ImageProcessor et est muté en direct ici, comme RetouchManager pour les
    retouches — pas de state dupliqué.
=========================================================*/

const CROP_HANDLE_TOLERANCE_PX = 24;
const CROP_MIN_SIZE = 0.02; // 2% de l'image, évite un cadre inversé/dégénéré

const CROP_RATIOS = {
    free: null,
    "4:3": 4 / 3,
    "5:7": 5 / 7,
    "7:5": 7 / 5,
    "2:3": 2 / 3,
    "3:2": 3 / 2,
    "1:1": 1,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    custom: null // 🔹 rempli dynamiquement par setCustomRatio() (dialogue "Personnalisé...")
};

class CropCanvasController {
    constructor(imageProcessor) {
        this.imageProcessor = imageProcessor;
        this.ratioId = "free";

        this.dragMode = null;     // null | "move" | "tl"|"t"|"tr"|"l"|"r"|"bl"|"b"|"br"
        this.dragStart = null;    // {x,y} normalisé au mousedown
        this.dragOrigRect = null; // copie de cropSettings au mousedown

        this.onCropChange = null;

        this._boundMouseDown = null;
        this._boundMouseMove = null;
        this._boundMouseUp = null;

        this._bindEvents();
    }

    // ---------------------------------------------------------------
    // Formule vérifiée : plus grand rectangle axis-aligned inscriptible
    // dans un rectangle w×h tourné de angleRad (recherche externe avant
    // implémentation, voir plan — algorithme "largest interior rectangle
    // after rotation").
    // ---------------------------------------------------------------
    static _largestInscribedRect(w, h, angleRad) {
        if (w <= 0 || h <= 0) return { width: 0, height: 0 };

        const widthIsLonger = w >= h;
        const longSide = widthIsLonger ? w : h;
        const shortSide = widthIsLonger ? h : w;

        const sinA = Math.abs(Math.sin(angleRad));
        const cosA = Math.abs(Math.cos(angleRad));

        if (shortSide <= 2 * sinA * cosA * longSide || Math.abs(sinA - cosA) < 1e-10) {
            const x = 0.5 * shortSide;
            return widthIsLonger
                ? { width: x / sinA, height: x / cosA }
                : { width: x / cosA, height: x / sinA };
        }

        const cos2a = cosA * cosA - sinA * sinA;
        return {
            width: (w * cosA - h * sinA) / cos2a,
            height: (h * cosA - w * sinA) / cos2a
        };
    }

    /**
     * Dimensions (en pixels) de la bounding box tournée courante — mêmes
     * dimensions que le buffer sur lequel cropSettings est normalisé.
     */
    _getBoundsSize() {
        const ip = this.imageProcessor;
        const srcBuffer = (ip.useFullResForDisplay && ip.fullResLoadedPath === ip.currentFilePath)
            ? ip.originalRawBuffer
            : (ip.previewBuffer || ip.originalRawBuffer);
        if (!srcBuffer) return { width: 1, height: 1 };
        return ip.getRotatedBounds(srcBuffer.width, srcBuffer.height, ip.transform);
    }

    /**
     * Convertit un ratio PHOTO (ex. 1.5 pour "3:2", largeur/hauteur en PIXELS
     * RÉELS) en ratio NORMALISÉ (rectWidth/rectHeight) — les deux ne sont PAS
     * interchangeables dès que la bounding box tournée n'est pas carrée
     * (systématique dès qu'un angle non multiple de 90° est actif : la
     * bounding box change même D'ASPECT avec l'angle). Confirmé nécessaire
     * par test réel : un rect normalisé à ratio 1.5 donnait un export à
     * ratio 1.77 sans cette conversion (bounding box 10826×8033 à 5°, déjà
     * différente de l'aspect original).
     * rectWidth/rectHeight = pixelRatio × (boundsHeight/boundsWidth).
     */
    _normalizedRatioFor(pixelRatio) {
        const bounds = this._getBoundsSize();
        if (!bounds.width || !bounds.height) return pixelRatio;
        return pixelRatio * (bounds.height / bounds.width);
    }

    /**
     * Zone valide (plus grand rectangle inscrit), en coordonnées normalisées
     * RELATIVES À LA BOUNDING BOX TOURNÉE (même référentiel que cropSettings).
     */
    _computeValidZoneNormalized() {
        const ip = this.imageProcessor;
        const srcBuffer = (ip.useFullResForDisplay && ip.fullResLoadedPath === ip.currentFilePath)
            ? ip.originalRawBuffer
            : (ip.previewBuffer || ip.originalRawBuffer);
        if (!srcBuffer) return { x: 0, y: 0, width: 1, height: 1 };

        const bounds = ip.getRotatedBounds(srcBuffer.width, srcBuffer.height, ip.transform);
        if (!bounds.width || !bounds.height) return { x: 0, y: 0, width: 1, height: 1 };

        const rotation = ((ip.transform.rotation % 360) + 360) % 360;
        const rad = (rotation * Math.PI) / 180;
        const { width: wr, height: hr } = CropCanvasController._largestInscribedRect(srcBuffer.width, srcBuffer.height, rad);

        return {
            x: (bounds.width - wr) / 2 / bounds.width,
            y: (bounds.height - hr) / 2 / bounds.height,
            width: wr / bounds.width,
            height: hr / bounds.height
        };
    }

    /**
     * Rétrécit {width,height} pour tenir dans zone — SI un ratio est
     * verrouillé, à l'échelle (facteur uniforme sur les deux axes, jamais
     * indépendamment) pour ne jamais casser le ratio ; sinon indépendamment
     * sur chaque axe. Confirmé nécessaire par test réel : un clamp
     * indépendant sur un rect 3:2 après une rotation qui réduit la zone
     * plus sur un axe que l'autre cassait silencieusement le ratio (ex.
     * 1.5 -> 1.35) sans qu'aucune erreur ne le signale.
     * @private
     */
    _clampSizeToZone(width, height, zone) {
        const ratio = CROP_RATIOS[this.ratioId];
        if (ratio) {
            const scale = Math.min(1, zone.width / width, zone.height / height);
            return { width: width * scale, height: height * scale };
        }
        return { width: Math.min(width, zone.width), height: Math.min(height, zone.height) };
    }

    /**
     * Contraint crop (rectX/Y/Width/Height) pour qu'il reste un SOUS-ENSEMBLE
     * de la zone valide — rétrécit d'abord si trop grand (voir
     * _clampSizeToZone, ratio préservé si verrouillé), puis repositionne.
     * Jamais un coin hors zone après appel.
     */
    _clampToValidZone(crop) {
        const zone = this._computeValidZoneNormalized();
        const sized = this._clampSizeToZone(crop.rectWidth, crop.rectHeight, zone);
        crop.rectWidth = sized.width;
        crop.rectHeight = sized.height;
        crop.rectX = Math.min(Math.max(crop.rectX, zone.x), zone.x + zone.width - crop.rectWidth);
        crop.rectY = Math.min(Math.max(crop.rectY, zone.y), zone.y + zone.height - crop.rectHeight);
    }

    /**
     * Appelé par cropPanel.js quand "Angle fin" change pendant que ce panneau
     * est actif : recontraint le cadre courant à la nouvelle zone valide.
     */
    onFineAngleChange() {
        const crop = this.imageProcessor.cropSettings;
        if (!crop) return;

        // 🔹 La bounding box tournée change d'ASPECT avec l'angle (pas
        // seulement de taille) — si un ratio est verrouillé, la hauteur
        // normalisée doit être re-dérivée de la largeur à CHAQUE changement
        // d'angle (voir _normalizedRatioFor), sinon le ratio réel en pixels
        // dérive silencieusement même si rectWidth/rectHeight ne bougent pas.
        const ratio = CROP_RATIOS[this.ratioId];
        if (ratio) {
            const normRatio = this._normalizedRatioFor(ratio);
            const cx = crop.rectX + crop.rectWidth / 2;
            const cy = crop.rectY + crop.rectHeight / 2;
            crop.rectHeight = crop.rectWidth / normRatio;
            crop.rectX = cx - crop.rectWidth / 2;
            crop.rectY = cy - crop.rectHeight / 2;
        }

        this._clampToValidZone(crop);
        this._render();
    }

    _ensureCropSettings() {
        const ip = this.imageProcessor;
        if (!ip.cropSettings) {
            ip.cropSettings = { enabled: true, ratioId: this.ratioId, rectX: 0, rectY: 0, rectWidth: 1, rectHeight: 1 };
        }
        return ip.cropSettings;
    }

    setRatio(ratioId) {
        this.ratioId = ratioId;
        const crop = this._ensureCropSettings();
        crop.ratioId = ratioId;

        const ratio = CROP_RATIOS[ratioId];
        if (ratio) {
            const normRatio = this._normalizedRatioFor(ratio);
            const cx = crop.rectX + crop.rectWidth / 2;
            const cy = crop.rectY + crop.rectHeight / 2;
            const newWidth = crop.rectWidth;
            const newHeight = newWidth / normRatio;
            crop.rectWidth = newWidth;
            crop.rectHeight = newHeight;
            crop.rectX = cx - newWidth / 2;
            crop.rectY = cy - newHeight / 2;
            this._clampToValidZone(crop);
        }

        this._notify();
        this._render();
    }

    /**
     * Ratio personnalisé saisi via le dialogue "Personnalisé..." (cropPanel.js).
     * Stocké dans CROP_RATIOS.custom, verrouillé exactement comme un ratio
     * prédéfini (5:7, 3:2, etc.) — même chemin dans setRatio/_constrainRatio.
     * rawW/rawH conservés uniquement pour pré-remplir le dialogue à sa
     * prochaine ouverture.
     */
    setCustomRatio(rawW, rawH) {
        if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) return false;
        CROP_RATIOS.custom = rawW / rawH;
        this.customRatioW = rawW;
        this.customRatioH = rawH;
        this.setRatio("custom");
        return true;
    }

    reset() {
        this.imageProcessor.cropSettings = { enabled: true, ratioId: "free", rectX: 0, rectY: 0, rectWidth: 1, rectHeight: 1 };
        this.ratioId = "free";
        this._clampToValidZone(this.imageProcessor.cropSettings);
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

        // 🔹 PAS clampé [0,1] (contrairement aux masques) : un drag proche du
        // bord doit rester fluide, le clamp final se fait dans _applyDrag via
        // _clampToValidZone.
        return { x: imgX / imgW, y: imgY / imgH };
    }

    _hitTestHandle(clientX, clientY) {
        const ip = this.imageProcessor;
        const crop = ip.cropSettings;
        if (!crop) return null;
        const display = ip.display;
        if (!display || !display.offscreenCanvas.width) return null;

        const pos = this._canvasToNormalized(clientX, clientY);
        const imgW = display.offscreenCanvas.width;
        const imgH = display.offscreenCanvas.height;
        const scale = display.scale || 1;

        const px = pos.x * imgW, py = pos.y * imgH;
        const rx = crop.rectX * imgW, ry = crop.rectY * imgH;
        const rw = crop.rectWidth * imgW, rh = crop.rectHeight * imgH;
        const tol = CROP_HANDLE_TOLERANCE_PX / scale;

        const handles = [
            { id: "tl", x: rx, y: ry },
            { id: "t", x: rx + rw / 2, y: ry },
            { id: "tr", x: rx + rw, y: ry },
            { id: "l", x: rx, y: ry + rh / 2 },
            { id: "r", x: rx + rw, y: ry + rh / 2 },
            { id: "bl", x: rx, y: ry + rh },
            { id: "b", x: rx + rw / 2, y: ry + rh },
            { id: "br", x: rx + rw, y: ry + rh }
        ];
        for (const handle of handles) {
            if (Math.hypot(px - handle.x, py - handle.y) <= tol) return handle.id;
        }

        if (px >= rx && px <= rx + rw && py >= ry && py <= ry + rh) return "move";
        return null;
    }

    _setCursor(hit) {
        const canvas = this.imageProcessor?.display?.canvas;
        if (!canvas) return;
        const cursors = {
            move: "move", tl: "nwse-resize", br: "nwse-resize",
            tr: "nesw-resize", bl: "nesw-resize",
            t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize"
        };
        canvas.style.cursor = cursors[hit] || "default";
    }

    /**
     * Contraint rect au ratio verrouillé après un resize libre. Poignée
     * coin : dérive la hauteur de la largeur, ancrée au coin OPPOSÉ (non
     * déplacé). Poignée côté seul : l'axe déplacé pilote, l'autre dimension
     * dérive du ratio en restant centrée (croissance symétrique).
     */
    _constrainRatio(rect, ratio, hasLeft, hasRight, hasTop, hasBottom) {
        const isCorner = (hasLeft || hasRight) && (hasTop || hasBottom);

        if (isCorner) {
            const newHeight = rect.width / ratio;
            const anchorY = hasTop ? rect.y + rect.height : rect.y;
            rect.height = newHeight;
            rect.y = hasTop ? anchorY - newHeight : anchorY;
            return rect;
        }

        if (hasLeft || hasRight) {
            const newHeight = rect.width / ratio;
            const cy = rect.y + rect.height / 2;
            rect.height = newHeight;
            rect.y = cy - newHeight / 2;
        } else {
            const newWidth = rect.height * ratio;
            const cx = rect.x + rect.width / 2;
            rect.width = newWidth;
            rect.x = cx - newWidth / 2;
        }
        return rect;
    }

    _applyDrag(dx, dy) {
        const crop = this.imageProcessor.cropSettings;
        const orig = this.dragOrigRect;
        const zone = this._computeValidZoneNormalized();

        if (this.dragMode === "move") {
            crop.rectX = Math.min(Math.max(orig.rectX + dx, zone.x), zone.x + zone.width - crop.rectWidth);
            crop.rectY = Math.min(Math.max(orig.rectY + dy, zone.y), zone.y + zone.height - crop.rectHeight);
            return;
        }

        let left = orig.rectX, top = orig.rectY;
        let right = orig.rectX + orig.rectWidth, bottom = orig.rectY + orig.rectHeight;

        const hasLeft = this.dragMode.includes("l");
        const hasRight = this.dragMode.includes("r");
        const hasTop = this.dragMode.includes("t");
        const hasBottom = this.dragMode.includes("b");

        if (hasLeft) left = orig.rectX + dx;
        if (hasRight) right = orig.rectX + orig.rectWidth + dx;
        if (hasTop) top = orig.rectY + dy;
        if (hasBottom) bottom = orig.rectY + orig.rectHeight + dy;

        if (hasLeft) left = Math.min(left, right - CROP_MIN_SIZE);
        if (hasRight) right = Math.max(right, left + CROP_MIN_SIZE);
        if (hasTop) top = Math.min(top, bottom - CROP_MIN_SIZE);
        if (hasBottom) bottom = Math.max(bottom, top + CROP_MIN_SIZE);

        let newRect = { x: left, y: top, width: right - left, height: bottom - top };

        const ratio = CROP_RATIOS[this.ratioId];
        if (ratio) {
            newRect = this._constrainRatio(newRect, this._normalizedRatioFor(ratio), hasLeft, hasRight, hasTop, hasBottom);
        }

        const sized = this._clampSizeToZone(newRect.width, newRect.height, zone);
        newRect.width = sized.width;
        newRect.height = sized.height;
        newRect.x = Math.min(Math.max(newRect.x, zone.x), zone.x + zone.width - newRect.width);
        newRect.y = Math.min(Math.max(newRect.y, zone.y), zone.y + zone.height - newRect.height);

        crop.rectX = newRect.x;
        crop.rectY = newRect.y;
        crop.rectWidth = newRect.width;
        crop.rectHeight = newRect.height;
    }

    _bindEvents() {
        if (this._boundMouseDown) window.removeEventListener("mousedown", this._boundMouseDown, true);
        if (this._boundMouseMove) window.removeEventListener("mousemove", this._boundMouseMove);
        if (this._boundMouseUp) window.removeEventListener("mouseup", this._boundMouseUp);

        this._boundMouseDown = (e) => {
            if (e.button !== 0) return;
            if (!this.imageProcessor.cropPanelActive) return;

            const canvas = this.imageProcessor?.display?.canvas;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const insideCanvas = (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            );
            if (!insideCanvas) return;

            this._ensureCropSettings();
            const hit = this._hitTestHandle(e.clientX, e.clientY);
            if (!hit) return;

            e.preventDefault();
            e.stopPropagation();

            this.dragMode = hit;
            this.dragStart = this._canvasToNormalized(e.clientX, e.clientY);
            this.dragOrigRect = { ...this.imageProcessor.cropSettings };
            this._setCursor(hit);
        };

        this._boundMouseMove = (e) => {
            if (!this.dragMode) {
                if (this.imageProcessor.cropPanelActive) {
                    this._setCursor(this._hitTestHandle(e.clientX, e.clientY));
                }
                return;
            }

            e.preventDefault();
            const pos = this._canvasToNormalized(e.clientX, e.clientY);
            this._applyDrag(pos.x - this.dragStart.x, pos.y - this.dragStart.y);
            this._renderOverlayOnly();
        };

        this._boundMouseUp = () => {
            if (!this.dragMode) return;
            this.dragMode = null;
            this.dragStart = null;
            this.dragOrigRect = null;
            this._setCursor(null);
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
        if (typeof this.onCropChange === "function") {
            this.onCropChange(this.imageProcessor.cropSettings);
        }
    }
}

if (typeof window !== "undefined") {
    window.CropCanvasController = CropCanvasController;
}
