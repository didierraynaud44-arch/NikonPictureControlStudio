/*=========================================================
    Pixel RAW - Module Monochrome : Dodge & Burn ciblé
    Éclaircit progressivement les hautes lumières (dodge) et assombrit
    progressivement les ombres (burn), via une transition douce
    (smoothstep) plutôt qu'un seuil dur.
=========================================================*/

class DodgeBurnFilter {
    apply(imageData, settings) {
        if (!settings) return imageData;

        const whiteAmt = Math.max(0, Math.min(100, settings.dodgeBurnWhite ?? 0)) / 100;
        const blackAmt = Math.max(0, Math.min(100, settings.dodgeBurnBlack ?? 0)) / 100;
        if (whiteAmt === 0 && blackAmt === 0) return imageData;

        const data = imageData.data;
        const len = data.length;

        // Plus le curseur est élevé, plus le seuil se rapproche du centre de
        // l'image tonale (donc plus de pixels concernés par l'effet).
        const whiteThreshold = 255 - whiteAmt * 180; // 255 (aucun effet) -> 75
        const blackThreshold = blackAmt * 180;        // 0 (aucun effet) -> 180
        const MAX_SHIFT = 60; // amplitude maximale de l'éclaircissement/assombrissement (niveaux)

        const smoothstep = (t) => t * t * (3 - 2 * t);

        // 🔹 Gomme locale (cible "dodgeBurn") : 1 = effet plein, 0 = supprimé à
        // ce pixel. Absente si rien n'est peint — voir ImageProcessor.
        // _injectMonoLocalMultipliers.
        const localMultiplier = settings.dodgeBurnLocalMultiplier;

        for (let i = 0, p = 0; i < len; i += 4, p++) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // Rec.709

            let shift = 0;

            if (whiteAmt > 0 && lum > whiteThreshold) {
                const t = (lum - whiteThreshold) / (255 - whiteThreshold);
                shift += smoothstep(t) * whiteAmt * MAX_SHIFT;
            }

            if (blackAmt > 0 && lum < blackThreshold) {
                const t = (blackThreshold - lum) / blackThreshold;
                shift -= smoothstep(t) * blackAmt * MAX_SHIFT;
            }

            if (localMultiplier) shift *= localMultiplier[p];

            if (shift === 0) continue;

            data[i]     = Math.max(0, Math.min(255, r + shift));
            data[i + 1] = Math.max(0, Math.min(255, g + shift));
            data[i + 2] = Math.max(0, Math.min(255, b + shift));
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.DodgeBurnFilter = DodgeBurnFilter;
}
