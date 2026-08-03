/*=========================================================
    Nikon Picture Control Studio - Mask Engine
    Calcule une carte d'opacité (0..1 par pixel) pour chaque
    type de masque, et fusionne un ajustement local dans l'image.
=========================================================*/

class MaskEngine {

    /**
     * Masque Linéaire (dégradé). Géométrie normalisée (0..1, relative à
     * la largeur/hauteur de l'image) :
     *   x1,y1 : point où l'effet est à 100%
     *   x2,y2 : point où l'effet est à 0%
     * Le dégradé s'étend perpendiculairement à l'axe (x1,y1)->(x2,y2)
     * sur toute la largeur de l'image (bandes infinies, comme un filtre
     * gradué photo).
     */
    static computeLinearAlpha(width, height, geometry) {
        const alpha = new Float32Array(width * height);

        const ax = geometry.x1 * width;
        const ay = geometry.y1 * height;
        const bx = geometry.x2 * width;
        const by = geometry.y2 * height;

        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy || 1e-6;

        // Progressivité indépendante de la distance entre les deux points.
        // feather = 1 -> comportement d'origine (transition sur toute la
        // distance glissée). feather < 1 -> transition plus dure, resserrée
        // autour du milieu. feather > 1 -> transition plus douce, étalée.
        const feather = Math.max(0.05, geometry.feather ?? 1);
        const midT = 0.5;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
                const adjustedT = midT + (t - midT) / feather;
                let a = 1 - adjustedT;
                if (a < 0) a = 0;
                if (a > 1) a = 1;
                alpha[y * width + x] = a;
            }
        }

        return geometry.invert ? MaskEngine._invert(alpha) : alpha;
    }

    /**
     * Masque Radial (ellipse). Géométrie normalisée (0..1) :
     *   cx,cy       : centre
     *   radiusX,radiusY : demi-axes (fraction de la largeur/hauteur)
     *   angle       : rotation en degrés
     *   feather     : 0..1, largeur de la zone de transition douce
     *                 (0 = bord net, 1 = dégradé jusqu'au centre)
     *   invert      : false = effet plein à l'intérieur, true = à l'extérieur
     */
    static computeRadialAlpha(width, height, geometry) {
        const alpha = new Float32Array(width * height);

        const cx = geometry.cx * width;
        const cy = geometry.cy * height;
        const rx = Math.max(1, geometry.radiusX * width);
        const ry = Math.max(1, geometry.radiusY * height);
        const angleRad = -(geometry.angle || 0) * Math.PI / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const feather = Math.min(1, Math.max(0, geometry.feather ?? 0.5));

        // Distance normalisée [innerEdge] où l'effet commence à s'atténuer
        const innerEdge = 1 - feather;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dx = x - cx;
                const dy = y - cy;

                // Rotation inverse pour ramener dans le repère de l'ellipse
                const rxLocal = dx * cosA - dy * sinA;
                const ryLocal = dx * sinA + dy * cosA;

                const d = Math.sqrt((rxLocal / rx) ** 2 + (ryLocal / ry) ** 2);

                let a;
                if (d <= innerEdge) {
                    a = 1;
                } else if (d >= 1) {
                    a = 0;
                } else {
                    // Transition lissée (smoothstep) entre innerEdge et 1
                    const t = (d - innerEdge) / Math.max(1e-6, 1 - innerEdge);
                    a = 1 - (t * t * (3 - 2 * t));
                }

                alpha[y * width + x] = a;
            }
        }

        return geometry.invert ? MaskEngine._invert(alpha) : alpha;
    }

    /**
     * Masque Pinceau. geometry.strokes = tableau de traits, chaque trait
     * est un tableau de points {x, y, radius, hardness} en coordonnées
     * normalisées (0..1) — radius en fraction de la largeur de l'image.
     * Rasterisé à la résolution demandée (permet un rendu correct aussi
     * bien en aperçu qu'à l'export pleine résolution).
     */
    static computeBrushAlpha(width, height, geometry) {
        const alpha = new Float32Array(width * height);
        const strokes = geometry.strokes || [];

        for (const stroke of strokes) {
            if (!stroke || stroke.length === 0) continue;

            // Interpolation entre points consécutifs pour éviter les trous
            // lors de traits tracés rapidement.
            const points = [];
            for (let i = 0; i < stroke.length; i++) {
                const p = stroke[i];
                points.push(p);
                if (i < stroke.length - 1) {
                    const next = stroke[i + 1];
                    const dist = Math.hypot(
                        (next.x - p.x) * width,
                        (next.y - p.y) * height
                    );
                    const radiusPx = Math.max(1, p.radius * width);
                    const steps = Math.min(50, Math.ceil(dist / Math.max(1, radiusPx * 0.25)));
                    for (let s = 1; s < steps; s++) {
                        const t = s / steps;
                        points.push({
                            x: p.x + (next.x - p.x) * t,
                            y: p.y + (next.y - p.y) * t,
                            radius: p.radius + (next.radius - p.radius) * t,
                            hardness: p.hardness + (next.hardness - p.hardness) * t
                        });
                    }
                }
            }

            for (const p of points) {
                const cx = p.x * width;
                const cy = p.y * height;
                const radiusPx = Math.max(1, p.radius * width);
                const hardness = Math.min(1, Math.max(0, p.hardness ?? 0.5));
                const innerRadius = radiusPx * hardness;

                const minX = Math.max(0, Math.floor(cx - radiusPx));
                const maxX = Math.min(width - 1, Math.ceil(cx + radiusPx));
                const minY = Math.max(0, Math.floor(cy - radiusPx));
                const maxY = Math.min(height - 1, Math.ceil(cy + radiusPx));

                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        const d = Math.hypot(x - cx, y - cy);
                        if (d > radiusPx) continue;

                        let a;
                        if (d <= innerRadius) {
                            a = 1;
                        } else {
                            const t = (d - innerRadius) / Math.max(1e-6, radiusPx - innerRadius);
                            a = 1 - (t * t * (3 - 2 * t));
                        }

                        const idx = y * width + x;
                        // Traits multiples : on garde le maximum (peinture cumulative)
                        if (a > alpha[idx]) alpha[idx] = a;
                    }
                }
            }
        }

        return geometry.invert ? MaskEngine._invert(alpha) : alpha;
    }

    static _invert(alpha) {
        const out = new Float32Array(alpha.length);
        for (let i = 0; i < alpha.length; i++) out[i] = 1 - alpha[i];
        return out;
    }

    /**
     * Calcule la carte d'alpha pour un masque, quel que soit son type.
     */
    static computeAlpha(width, height, mask) {
        switch (mask.type) {
            case "linear": return MaskEngine.computeLinearAlpha(width, height, mask.geometry);
            case "radial": return MaskEngine.computeRadialAlpha(width, height, mask.geometry);
            case "brush":  return MaskEngine.computeBrushAlpha(width, height, mask.geometry);
            default:
                console.warn("⚠️ Type de masque inconnu :", mask.type);
                return new Float32Array(width * height); // aucun effet
        }
    }

    /**
     * Applique les réglages locaux d'un masque à une image, en fusionnant
     * uniquement dans la zone couverte par son alpha.
     * - imageData : image courante (déjà passée par le pipeline global)
     * - mask      : { type, geometry, adjustments, enabled, opacity }
     * - pipeline  : instance de RenderPipeline (réutilise les mêmes filtres)
     * Retourne une NOUVELLE ImageData (l'originale n'est pas modifiée).
     */
    static applyMask(imageData, mask, pipeline) {
        if (!mask || mask.enabled === false) return imageData;

        const width = imageData.width;
        const height = imageData.height;

        const alpha = MaskEngine.computeAlpha(width, height, mask);
        const globalOpacity = mask.opacity ?? 1;

        // Clone pour ne pas modifier l'original avant fusion
        const original = imageData.data;
        const workingCopy = new ImageData(
            new Uint8ClampedArray(original),
            width,
            height
        );

        // Applique le pipeline standard avec UNIQUEMENT les réglages du masque
        const adjusted = pipeline.process(workingCopy, mask.adjustments || {});

        const outData = new Uint8ClampedArray(original.length);
        for (let i = 0, p = 0; i < original.length; i += 4, p++) {
            const a = alpha[p] * globalOpacity;
            if (a <= 0) {
                outData[i] = original[i];
                outData[i + 1] = original[i + 1];
                outData[i + 2] = original[i + 2];
                outData[i + 3] = original[i + 3];
                continue;
            }
            outData[i]     = original[i]     * (1 - a) + adjusted.data[i]     * a;
            outData[i + 1] = original[i + 1] * (1 - a) + adjusted.data[i + 1] * a;
            outData[i + 2] = original[i + 2] * (1 - a) + adjusted.data[i + 2] * a;
            outData[i + 3] = original[i + 3];
        }

        return new ImageData(outData, width, height);
    }

    /**
     * Applique une liste de masques séquentiellement (chacun agit sur le
     * résultat du précédent), après le pipeline global.
     */
    static applyAllMasks(imageData, masks, pipeline) {
        let current = imageData;
        for (const mask of (masks || [])) {
            current = MaskEngine.applyMask(current, mask, pipeline);
        }
        return current;
    }
}

if (typeof window !== "undefined") {
    window.MaskEngine = MaskEngine;
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = MaskEngine;
}
