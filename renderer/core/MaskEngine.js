/*=========================================================
    Nikon Picture Control Studio - Mask Engine
    Calcule une carte d'opacité (0..1 par pixel) pour chaque
    type de masque, et fusionne un ajustement local dans l'image.
=========================================================*/

class MaskEngine {

    static computeLinearAlpha(width, height, geometry) {
        const alpha = new Float32Array(width * height);

        const ax = geometry.x1 * width;
        const ay = geometry.y1 * height;
        const bx = geometry.x2 * width;
        const by = geometry.y2 * height;

        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy || 1e-6;

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

        const innerEdge = 1 - feather;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dx = x - cx;
                const dy = y - cy;

                const rxLocal = dx * cosA - dy * sinA;
                const ryLocal = dx * sinA + dy * cosA;

                const d = Math.sqrt((rxLocal / rx) ** 2 + (ryLocal / ry) ** 2);

                let a;
                if (d <= innerEdge) {
                    a = 1;
                } else if (d >= 1) {
                    a = 0;
                } else {
                    const t = (d - innerEdge) / Math.max(1e-6, 1 - innerEdge);
                    a = 1 - (t * t * (3 - 2 * t));
                }

                alpha[y * width + x] = a;
            }
        }

        return geometry.invert ? MaskEngine._invert(alpha) : alpha;
    }

    static computeBrushAlpha(width, height, geometry) {
        const alpha = new Float32Array(width * height);
        const strokes = geometry.strokes || [];

        for (const stroke of strokes) {
            if (!stroke || stroke.length === 0) continue;

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

    /** Encode une alpha map (Float32Array 0..1) en PNG niveaux de gris base64
     * — format de stockage de mask.geometry.alphaMapDataUrl pour les masques
     * IA (Ciel/Sujet/Arrière-plan), plus compact qu'un Float32Array brut pour
     * la persistance par photo. Utilisé à la création (masksPanel.js) et pour
     * inverser un masque "subject" existant en "background" sans nouveau
     * calcul IA. */
    static encodeAlphaToDataUrl(alpha, width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(width, height);
        for (let p = 0; p < alpha.length; p++) {
            const v = Math.max(0, Math.min(255, Math.round(alpha[p] * 255)));
            const i = p * 4;
            imgData.data[i] = v;
            imgData.data[i + 1] = v;
            imgData.data[i + 2] = v;
            imgData.data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas.toDataURL("image/png");
    }

    /** Décode une alphaMapDataUrl PNG en Float32Array (0..1), width×height
     * demandés — utilisé pour inverser un masque "subject" en "background"
     * (voir masksPanel.js), PAS par computeAlpha() qui reste synchrone via
     * son propre cache (voir computeAiAlpha). */
    static decodeAlphaMapDataUrl(dataUrl, width, height) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                const data = ctx.getImageData(0, 0, width, height).data;
                const alpha = new Float32Array(width * height);
                for (let i = 0, p = 0; i < data.length; i += 4, p++) alpha[p] = data[i] / 255;
                resolve(alpha);
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    // 🔹 Masques IA (Ciel/Sujet/Arrière-plan, voir AIMaskEngine.js) : la carte
    // d'opacité est déjà calculée en amont (asynchrone, coûteux) et stockée en
    // PNG niveaux de gris base64 (mask.geometry.alphaMapDataUrl) — plus
    // compact qu'un Float32Array brut pour la persistance par photo. Décodage
    // PNG forcément asynchrone (Image.onload), donc impossible de le faire
    // directement ici : computeAlpha() doit rester synchrone (appelée à
    // chaque frame de render()). On décode donc UNE FOIS en arrière-plan (mis
    // en cache par mask.id, jamais redécodé ensuite) et on renvoie une alpha
    // vide (aucun effet) le temps que ce soit prêt — un nouveau render() est
    // redemandé automatiquement dès le décodage terminé.
    static _aiAlphaImageCache = new Map();    // mask.id -> HTMLImageElement
    static _aiAlphaResampleCache = new Map(); // "${mask.id}:${w}x${h}" -> Float32Array (probabilité BRUTE, non seuillée, non inversée)

    /** smoothstep(edge0, edge1, x), bornée [0,1] — transition en S standard. */
    static _smoothstep(edge0, edge1, x) {
        if (edge0 >= edge1) return x < edge0 ? 0 : 1;
        let t = (x - edge0) / (edge1 - edge0);
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        return t * t * (3 - 2 * t);
    }

    /**
     * Recentre la probabilité brute (0..1) sur un seuil réglable, avec une
     * largeur d'adoucissement réglable, via smoothstep — PAS un seuil dur :
     * softness=0 -> transition la plus abrupte possible (une seule valeur de
     * gris fait basculer 0→1), softness=1 -> transition la plus large possible
     * (couvre tout l'intervalle 0..1, proche d'un simple remappage en S de la
     * probabilité d'origine, comportement le plus proche de l'ancien calcul
     * SANS seuil du tout — c'est pourquoi c'est la valeur par défaut : ne pas
     * durcir les bords par défaut pour les masques déjà créés/à créer).
     */
    static _applyThresholdSoftness(alpha, threshold, softness) {
        const halfWidth = Math.max(0.001, softness * 0.5);
        const edge0 = threshold - halfWidth;
        const edge1 = threshold + halfWidth;
        const out = new Float32Array(alpha.length);
        for (let i = 0; i < alpha.length; i++) out[i] = MaskEngine._smoothstep(edge0, edge1, alpha[i]);
        return out;
    }

    static computeAiAlpha(width, height, mask) {
        const dataUrl = mask.geometry && mask.geometry.alphaMapDataUrl;
        if (!dataUrl) return new Float32Array(width * height); // calcul IA pas encore terminé

        // 🔹 Le cache par résolution stocke la probabilité BRUTE (avant seuil/
        // adoucissement/inversion) : ces trois réglages peuvent être modifiés à
        // tout moment par l'utilisateur (curseurs "Seuil"/"Adoucissement",
        // bouton "Inverser"), donc recalculés à chaque appel à partir de la
        // valeur en cache plutôt que figés dedans (évite d'invalider le cache
        // — donc de redécoder le PNG — à chaque réglage).
        const resampleKey = `${mask.id}:${width}x${height}`;
        let rawAlpha = MaskEngine._aiAlphaResampleCache.get(resampleKey);

        if (!rawAlpha) {
            const cachedImg = MaskEngine._aiAlphaImageCache.get(mask.id);
            if (cachedImg instanceof HTMLImageElement && cachedImg.complete && cachedImg.naturalWidth > 0) {
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(cachedImg, 0, 0, width, height);
                const data = ctx.getImageData(0, 0, width, height).data;
                rawAlpha = new Float32Array(width * height);
                for (let i = 0, p = 0; i < data.length; i += 4, p++) rawAlpha[p] = data[i] / 255;
                MaskEngine._aiAlphaResampleCache.set(resampleKey, rawAlpha);
            } else {
                if (!MaskEngine._aiAlphaImageCache.has(mask.id)) {
                    const img = new Image();
                    MaskEngine._aiAlphaImageCache.set(mask.id, img);
                    img.onload = () => {
                        if (window.imageProcessor) window.imageProcessor.render();
                    };
                    img.onerror = () => console.error("❌ Erreur décodage carte d'opacité IA pour le masque", mask.id);
                    img.src = dataUrl;
                }
                return new Float32Array(width * height); // décodage en cours (1ère frame)
            }
        }

        const threshold = mask.geometry.threshold ?? 0.5;
        const softness = mask.geometry.softness ?? 1;
        const shaped = MaskEngine._applyThresholdSoftness(rawAlpha, threshold, softness);

        // 🔹 Inversion appliquée EN TOUT DERNIER, sur le résultat seuil+adouci
        // déjà affiné — pas sur la probabilité brute — pour que "Inverser"
        // bascule le résultat final visible, cohérent quels que soient les
        // réglages de Seuil/Adoucissement en place.
        return mask.geometry.invert ? MaskEngine._invert(shaped) : shaped;
    }

    static computeAlpha(width, height, mask) {
        switch (mask.type) {
            case "linear": return MaskEngine.computeLinearAlpha(width, height, mask.geometry);
            case "radial": return MaskEngine.computeRadialAlpha(width, height, mask.geometry);
            case "brush":  return MaskEngine.computeBrushAlpha(width, height, mask.geometry);
            case "sky":
            case "subject":
            case "background":
                return MaskEngine.computeAiAlpha(width, height, mask);
            default:
                console.warn("⚠️ Type de masque inconnu :", mask.type);
                return new Float32Array(width * height);
        }
    }

    static applyMask(imageData, mask, pipeline) {
        if (!mask || mask.enabled === false) return imageData;

        const width = imageData.width;
        const height = imageData.height;

        const alpha = MaskEngine.computeAlpha(width, height, mask);
        const globalOpacity = mask.opacity ?? 1;

        const original = imageData.data;
        const workingCopy = new ImageData(
            new Uint8ClampedArray(original),
            width,
            height
        );

        // 🛠️ CORRECTION : Fusionner les réglages du masque avec le Picture Control global
        const basePc = window.imageProcessor?.pictureControl || {};
        const combinedAdjustments = { ...basePc, ...(mask.adjustments || {}) };

        let adjusted = null;
        try {
            adjusted = pipeline.process(workingCopy, combinedAdjustments);
        } catch (err) {
            console.error("❌ Erreur traitement pipeline masque :", err);
            return imageData;
        }

        if (!adjusted || !adjusted.data) return imageData;

        const outData = new Uint8ClampedArray(original.length);
        for (let i = 0, p = 0; i < original.length; i += 4, p++) {
            const a = alpha[p] * globalOpacity;
            if (a <= 0) {
                outData[i]     = original[i];
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