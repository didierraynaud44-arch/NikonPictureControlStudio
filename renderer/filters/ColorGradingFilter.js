class ColorGradingFilter {
    constructor() {
        this.name = "ColorGrading";
    }

    // Convertit une teinte (0-360°) + une chroma (0-1) en un delta RGB additif
    // centré sur le gris neutre (utilisé pour teinter shadows/midtone/highlights)
    hueChromaToRgbDelta(hueDeg, chroma) {
        const h = (hueDeg / 360) % 1;
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const l = 0.5;
        const s = Math.min(1, Math.abs(chroma));
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const r = hue2rgb(p, q, h + 1 / 3) * 255;
        const g = hue2rgb(p, q, h) * 255;
        const b = hue2rgb(p, q, h - 1 / 3) * 255;

        const sign = chroma < 0 ? -1 : 1;
        return { r: (r - 128) * sign, g: (g - 128) * sign, b: (b - 128) * sign };
    }

    apply(imageData, pc) {
        if (!imageData || !pc) return imageData;

        if (pc.isMonochrome) return imageData;

        const cg = pc.colorGrading && typeof pc.colorGrading === "object" ? pc.colorGrading : null;
        if (!cg) return imageData;

        const zones = ["shadows", "midTone", "highlights"];
        const hasEffect = zones.some(z => {
            const v = cg[z];
            return v && (Math.abs(v.chroma || 0) > 0.01 || Math.abs(v.brightness || 0) > 0.01);
        });
        if (!hasEffect) return imageData;

        const data = imageData.data;
        const len = data.length;

        const balance = (cg.balance || 0) / 100;              // -1..1
        const blending = Math.min(1, Math.max(0.05, (cg.blending ?? 50) / 100)); // 0.05..1 (largeur de transition)

        // Pré-calcul des teintes RGB additives pour chaque zone (indépendant du pixel)
        const tints = {};
        zones.forEach(z => {
            const v = cg[z] || {};
            const chroma = (v.chroma || 0) / 100; // -1..1
            const delta = this.hueChromaToRgbDelta(v.hue || 0, chroma);
            tints[z] = {
                r: delta.r,
                g: delta.g,
                b: delta.b,
                brightness: (v.brightness || 0) / 100 * 40 // -40..40 (valeur additive de luminosité)
            };
        });

        // Point d'équilibre entre ombres et hautes lumières (décalé par "balance")
        const mid = Math.min(0.9, Math.max(0.1, 0.5 - balance * 0.3));

        for (let i = 0; i < len; i += 4) {
            const luminance = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;

            // Poids bruts par zone selon la luminance du pixel
            let wShadow = 1 - Math.min(1, luminance / mid);
            let wHighlight = Math.min(1, Math.max(0, (luminance - mid) / (1 - mid)));
            let wMid = Math.max(0, 1 - wShadow - wHighlight);

            // "blending" adoucit la transition entre zones (mélange vers une répartition plus égale)
            const softness = blending;
            const avg = (wShadow + wMid + wHighlight) / 3;
            wShadow = wShadow * (1 - softness) + avg * softness;
            wMid = wMid * (1 - softness) + avg * softness;
            wHighlight = wHighlight * (1 - softness) + avg * softness;

            const total = wShadow + wMid + wHighlight || 1;
            wShadow /= total; wMid /= total; wHighlight /= total;

            const tS = tints.shadows, tM = tints.midTone, tH = tints.highlights;

            const dr = tS.r * wShadow + tM.r * wMid + tH.r * wHighlight;
            const dg = tS.g * wShadow + tM.g * wMid + tH.g * wHighlight;
            const db = tS.b * wShadow + tM.b * wMid + tH.b * wHighlight;
            const dBright = tS.brightness * wShadow + tM.brightness * wMid + tH.brightness * wHighlight;

            data[i]     = Math.min(255, Math.max(0, data[i]     + dr + dBright));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + dg + dBright));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + db + dBright));
        }

        return imageData;
    }
}

window.ColorGradingFilter = ColorGradingFilter;
