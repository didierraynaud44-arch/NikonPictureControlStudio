/*=========================================================
    Pixel RAW - Module Monochrome : Mixeur N&B 8 canaux
    Même architecture de pondération par distance de teinte (cosinus,
    bande ±45°) que ColorBlenderFilter.js.
=========================================================*/

class MonochromeMixerFilter {
    constructor() {
        // 8 canaux, centrés tous les 45°, associés à leur clé de réglage ET à
        // leur clé de cible pour la Gomme locale (settings.channelLocalMultipliers,
        // voir ImageProcessor._injectMonoLocalMultipliers — mêmes clés que
        // MonochromeManager.ERASE_TARGETS).
        this.channels = [
            { settingKey: "monoMixerRed",     colorKey: "red",     center: 0 },
            { settingKey: "monoMixerOrange",  colorKey: "orange",  center: 45 },
            { settingKey: "monoMixerYellow",  colorKey: "yellow",  center: 90 },
            { settingKey: "monoMixerGreen",   colorKey: "green",   center: 135 },
            { settingKey: "monoMixerCyan",    colorKey: "cyan",    center: 180 },
            { settingKey: "monoMixerBlue",    colorKey: "blue",    center: 225 },
            { settingKey: "monoMixerViolet",  colorKey: "violet",  center: 270 },
            { settingKey: "monoMixerMagenta", colorKey: "magenta", center: 315 }
        ];
    }

    // Teinte (0-360) + saturation (0-1) — même formule que ColorBlenderFilter,
    // la luminance (L de HSL) n'est pas utilisée ici (luminance de base en Rec.709).
    rgbToHueSat(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0, s = 0;

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

        return [h * 360, s];
    }

    hueDistance(a, b) {
        const d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    }

    apply(imageData, settings) {
        if (!settings || !settings.monoMixerEnabled) return imageData;

        const data = imageData.data;
        const len = data.length;
        const BAND_WIDTH = 45;

        // Facteur d'échelle à calibrer empiriquement : convertit la moyenne
        // pondérée des curseurs (-100..200 chacun) en delta de luminance
        // (niveaux 0-255) d'amplitude raisonnable. Recalibré à la baisse (1.4
        // -> 0.7) lors de l'ajout de la normalisation par totalWeight
        // ci-dessous : sans normalisation, la plupart des teintes (à cheval
        // entre deux canaux à 45° d'écart, soit presque partout puisque
        // BAND_WIDTH == l'écart entre canaux) recevaient la somme non
        // pondérée de DEUX canaux, gonflant l'effet ~2x par rapport à une
        // teinte pile au centre d'un seul canal. Un push max sur un seul
        // curseur pile au centre restait déjà marqué avec SCALE=1.4 (identique
        // avant/après la normalisation dans ce cas précis, un seul canal
        // contribue) ; le réduire évite qu'il ne crame en blanc/noir pur.
        const SCALE = 0.7;

        const sliders = this.channels.map(({ settingKey, colorKey, center }) => ({
            center,
            colorKey,
            value: settings[settingKey] ?? 0
        }));

        // 🔹 Gomme locale : carte de multiplicateur par canal (1 = effet plein,
        // 0 = effet supprimé à ce pixel pour ce canal précis). Absente si rien
        // n'est peint sur aucun canal — voir ImageProcessor._injectMonoLocalMultipliers.
        const channelLocalMultipliers = settings.channelLocalMultipliers;

        for (let i = 0, p = 0; i < len; i += 4, p++) {
            const r = data[i], g = data[i + 1], b = data[i + 2];

            const [h, s] = this.rgbToHueSat(r, g, b);
            const baseLum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // Rec.709

            let weightedSum = 0;
            let totalWeight = 0;
            for (const { center, colorKey, value } of sliders) {
                const dist = this.hueDistance(h, center);
                if (dist >= BAND_WIDTH) continue;
                const weight = Math.cos((dist / BAND_WIDTH) * (Math.PI / 2));
                const localMult = channelLocalMultipliers && channelLocalMultipliers[colorKey]
                    ? channelLocalMultipliers[colorKey][p]
                    : 1;
                weightedSum += value * weight * localMult;
                totalWeight += weight;
            }
            // Ramène la somme à une MOYENNE pondérée (même principe que
            // ColorBlenderFilter.js) : sans ça, une teinte à cheval entre deux
            // canaux adjacents (ex: Rouge/Orange) additionne les deux curseurs
            // au lieu de les moyenner, doublant l'effet par rapport à une
            // teinte pile au centre d'un seul canal. totalWeight === 0 (aucun
            // canal dans la bande de ce pixel) : aucune contribution, comme avant.
            const normalizedSum = totalWeight > 0 ? weightedSum / totalWeight : 0;

            // La contribution du mixeur est proportionnelle à la saturation du
            // pixel : un pixel déjà gris (s=0) n'est affecté par aucun canal.
            const finalLum = baseLum + normalizedSum * s * SCALE;
            const clamped = Math.max(0, Math.min(255, finalLum));

            data[i] = data[i + 1] = data[i + 2] = clamped;
        }

        return imageData;
    }
}

// 🔹 Clés des 8 canaux, dans le même ordre/nommage que MonochromeManager.
// ERASE_TARGETS — référencées par ImageProcessor._injectMonoLocalMultipliers
// pour savoir quelles cibles de la Gomme locale concernent ce filtre.
MonochromeMixerFilter.CHANNEL_KEYS = ["red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta"];

if (typeof window !== "undefined") {
    window.MonochromeMixerFilter = MonochromeMixerFilter;
}
