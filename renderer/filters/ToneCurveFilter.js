class ToneCurveFilter {
    constructor() {
        this.name = "ToneCurve";
    }

    // Sécurisation de la normalisation des points
    normalizePoints(rawPoints, numericValue = 0) {
        // 1. Si on reçoit déjà un tableau valide de points
        if (Array.isArray(rawPoints) && rawPoints.length > 0) {
            return rawPoints;
        }

        // 2. Si on reçoit un simple nombre (ex: slider toneCurve de -5 à +5)
        // On génère dynamiquement une courbe à 3 points (Ombres, Tons moyens, Hautes lumières)
        const val = typeof rawPoints === "number" ? rawPoints : numericValue;
        const midShift = val * 10; // Décale le point milieu selon le slider

        return [
            { x: 0, y: 0 },
            { x: 128, y: Math.min(255, Math.max(0, 128 + midShift)) },
            { x: 255, y: 255 }
        ];
    }

    buildLut256(points) {
        const lut = new Uint8Array(256);
        const pts = this.normalizePoints(points);

        // Interpolation simple (ou linéaire entre les points de la courbe)
        for (let i = 0; i < 256; i++) {
            // Recherche du segment
            let p1 = pts[0];
            let p2 = pts[pts.length - 1];

            for (let j = 0; j < pts.length - 1; j++) {
                if (i >= pts[j].x && i <= pts[j + 1].x) {
                    p1 = pts[j];
                    p2 = pts[j + 1];
                    break;
                }
            }

            if (p1.x === p2.x) {
                lut[i] = p1.y;
            } else {
                const t = (i - p1.x) / (p2.x - p1.x);
                lut[i] = Math.min(255, Math.max(0, Math.round(p1.y + t * (p2.y - p1.y))));
            }
        }
        return lut;
    }

    apply(imageData, pc) {
        if (!imageData || !pc) return imageData;

        // Extraction souple : soit les points de courbe du NP3/NEF, soit le chiffre du slider
        const rawPoints = pc.toneCurvePoints || pc.curvePoints || pc.toneCurve;
        const sliderValue = typeof pc.toneCurve === "number" ? pc.toneCurve : 0;

        // Si pas de points et slider à 0, on gagne du temps
        if (!rawPoints && sliderValue === 0) return imageData;

        const points = this.normalizePoints(rawPoints, sliderValue);
        const lut = this.buildLut256(points);

        const data = imageData.data;
        const len = data.length;

        // Application du LUT sur Rouge, Vert, Bleu
        for (let i = 0; i < len; i += 4) {
            data[i]     = lut[data[i]];     // R
            data[i + 1] = lut[data[i + 1]]; // G
            data[i + 2] = lut[data[i + 2]]; // B
        }

        return imageData;
    }
}

window.ToneCurveFilter = ToneCurveFilter;