class ColorBlenderFilter {
    constructor() {
        this.name = "ColorBlender";

        // 8 canaux du Color Blender NP3, centrés tous les 45°
        this.channels = [
            { key: "red",     center: 0 },
            { key: "orange",  center: 45 },
            { key: "yellow",  center: 90 },
            { key: "green",   center: 135 },
            { key: "cyan",    center: 180 },
            { key: "blue",    center: 225 },
            { key: "purple",  center: 270 },
            { key: "magenta", center: 315 }
        ];
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

    // Distance angulaire minimale entre deux teintes (0-360)
    hueDistance(a, b) {
        const d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    }

    apply(imageData, pc) {
        if (!imageData || !pc) return imageData;

        if (pc.isMonochrome) return imageData;

        // --- Décalage de teinte global (champ "Teinte" du panneau NCP, inchangé) ---
        const rawHue = pc.hue ?? pc.colorBalance ?? pc.hueAdjustment ?? 0;
        const globalHueShift = typeof rawHue === "number" ? rawHue : parseFloat(rawHue) || 0;
        const globalDegrees = globalHueShift * 3;

        // --- Color Blender NP3 (8 canaux) ---
        const cb = pc.colorBlender && typeof pc.colorBlender === "object" ? pc.colorBlender : null;
        const blenderActive = cb && this.channels.some(({ key }) => {
            const v = cb[key];
            return v && (v.hue || v.chroma || v.brightness);
        });

        // Rien à faire du tout : sortie rapide
        if (globalDegrees === 0 && !blenderActive) return imageData;

        const data = imageData.data;
        const len = data.length;
        const BAND_WIDTH = 45; // demi-largeur d'influence de chaque canal (chevauchement doux)

        for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            let [h, s, l] = this.rgbToHsl(r, g, b);

            // 1. Décalage de teinte global
            if (globalDegrees !== 0) {
                h = (h + globalDegrees + 360) % 360;
            }

            // 2. Color Blender par canal (uniquement si le pixel a de la saturation)
            if (blenderActive && s > 0.02) {
                let hueShiftSum = 0, chromaShiftSum = 0, brightnessShiftSum = 0, weightSum = 0;

                for (const { key, center } of this.channels) {
                    const settings = cb[key];
                    if (!settings) continue;

                    const dist = this.hueDistance(h, center);
                    if (dist >= BAND_WIDTH) continue;

                    // Poids en cosinus : 1 au centre du canal, 0 en bord de bande
                    const weight = Math.cos((dist / BAND_WIDTH) * (Math.PI / 2));

                    hueShiftSum += (settings.hue || 0) * weight;
                    chromaShiftSum += (settings.chroma || 0) * weight;
                    brightnessShiftSum += (settings.brightness || 0) * weight;
                    weightSum += weight;
                }

                if (weightSum > 0) {
                    const hueDelta = (hueShiftSum / weightSum) * 0.6;       // -100..100 -> ~-60..60°
                    const chromaDelta = (chromaShiftSum / weightSum) / 100;  // -1..1 relatif
                    const brightnessDelta = (brightnessShiftSum / weightSum) / 200; // -0.5..0.5 relatif

                    h = (h + hueDelta + 360) % 360;
                    s = Math.min(1, Math.max(0, s * (1 + chromaDelta)));
                    l = Math.min(1, Math.max(0, l + brightnessDelta));
                }
            }

            const [newR, newG, newB] = this.hslToRgb(h, s, l);
            data[i]     = newR;
            data[i + 1] = newG;
            data[i + 2] = newB;
        }

        return imageData;
    }
}

window.ColorBlenderFilter = ColorBlenderFilter;
