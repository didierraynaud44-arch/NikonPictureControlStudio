class HighlightsFilter extends BaseFilter {

    apply(imageData, pictureControl) {

        if (!pictureControl)
            return imageData;

        const highlights = Number(pictureControl.highlights);

        if (this.isNeutral(highlights))
            return imageData;

        // Normalisation (amplitude douce basée sur l'échelle -5 à +5)
        const amount = highlights / 5.0;

        const data = imageData.data;
        const len = data.length;

        // 1. PRÉ-CALCUL ULTRA-RAPIDE (256 itérations seulement au lieu de millions)
        const lut = new Uint8Array(256);

        for (let i = 0; i < 256; i++) {
            const norm = i / 255;

            // Masque progressif des hautes lumières (entre ~128 et 255)
            const highlightWeight = Math.max(0, (norm - 0.5) / 0.5);
            const smoothWeight = highlightWeight * highlightWeight * (3 - 2 * highlightWeight);

            let newNorm = norm;
            if (amount < 0) {
                // Diminuer les hautes lumières
                newNorm = norm + (amount * 0.25 * smoothWeight * norm);
            } else {
                // Rehausser les hautes lumières
                newNorm = norm + (amount * 0.20 * smoothWeight * (1 - norm));
            }

            lut[i] = this.clamp(newNorm * 255);
        }

        // 2. APPLICATION ÉCLAIR SUR LES PIXELS (Accès mémoire direct)
        for (let i = 0; i < len; i += 4) {
            data[i]     = lut[data[i]];     // R
            data[i + 1] = lut[data[i + 1]]; // G
            data[i + 2] = lut[data[i + 2]]; // B
        }

        return imageData;

    }

}

window.HighlightsFilter = HighlightsFilter;