class ColorBlenderFilter {
    constructor() {
        this.name = "ColorBlender";
    }

    // Convertit RGB (0-255) en HSL (H: 0-360, S: 0-1, L: 0-1)
    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h * 360, s, l];
    }

    // Convertit HSL en RGB (0-255)
    hslToRgb(h, s, l) {
        h /= 360;
        let r, g, b;

        if (s === 0) {
            r = g = b = l; // Achromatique (gris)
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }

        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    apply(imageData, pc) {
        if (!imageData || !pc) return imageData;

        // Extraction souple : valeur numérique du slider (-5 à +5) ou valeur du profil
        const rawHue = pc.hue ?? pc.colorBalance ?? pc.hueAdjustment ?? 0;
        
        // Conversion numérique sécurisée
        const hueShift = typeof rawHue === "number" ? rawHue : parseFloat(rawHue) || 0;

        // Si le décalage de teinte est nul, on ne recalcule rien (gain de performances)
        if (hueShift === 0) return imageData;

        const data = imageData.data;
        const len = data.length;

        // Calcul du décalage en degrés (ex: -5 à +5 devient environ -15° à +15°)
        const degrees = hueShift * 3;

        for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // 1. Passage en HSL
            let [h, s, l] = this.rgbToHsl(r, g, b);

            // 2. Décalage de la teinte
            h = (h + degrees + 360) % 360;

            // 3. Retour en RGB
            const [newR, newG, newB] = this.hslToRgb(h, s, l);

            data[i]     = newR;
            data[i + 1] = newG;
            data[i + 2] = newB;
        }

        return imageData;
    }
}

window.ColorBlenderFilter = ColorBlenderFilter;