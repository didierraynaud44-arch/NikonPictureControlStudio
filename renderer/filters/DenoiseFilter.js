/*=========================================================
    Nikon Picture Control Studio - Denoise Filter (Visible & Net)
=========================================================*/

class DenoiseFilter {
    process(imageData, settings) {
        const amount = settings.denoise ?? 0;
        if (amount === 0) return imageData;

        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;

        const copy = new Uint8ClampedArray(data);

        // Paramètres réactifs basés sur le slider (0 à 5)
        // 1. Chrominance : suppression progressive et visible du bruit coloré
        const chromaBlend = Math.min(1.0, amount * 0.22); 
        // 2. Luminance : lissage léger de la structure de grain
        const lumaBlend = Math.min(0.5, amount * 0.08); 

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = (y * width + x) * 4;

                const r = copy[i];
                const g = copy[i + 1];
                const b = copy[i + 2];

                // Index des 4 voisins direct (haut, bas, gauche, droite)
                const iL = i - 4;
                const iR = i + 4;
                const iT = i - width * 4;
                const iB = i + width * 4;

                // Moyennes RVB environnantes
                const avgR = (copy[iL] + copy[iR] + copy[iT] + copy[iB]) * 0.25;
                const avgG = (copy[iL + 1] + copy[iR + 1] + copy[iT + 1] + copy[iB + 1]) * 0.25;
                const avgB = (copy[iL + 2] + copy[iR + 2] + copy[iT + 2] + copy[iB + 2]) * 0.25;

                // Conversion en Luminance (Y) et Chrominance (Cb, Cr)
                const yOrig = 0.299 * r + 0.587 * g + 0.114 * b;
                const yAvg  = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;

                const cbOrig = -0.168736 * r - 0.331264 * g + 0.5 * b;
                const cbAvg  = -0.168736 * avgR - 0.331264 * avgG + 0.5 * avgB;

                const crOrig = 0.5 * r - 0.418688 * g - 0.081312 * b;
                const crAvg  = 0.5 * avgR - 0.418688 * avgG - 0.081312 * avgB;

                // Application du filtrage :
                // - Chrominance lissée vers la moyenne (élimine le bruit de couleur)
                // - Luminance lissée très légèrement pour atténuer le grain sans casser les contours
                const newY  = yOrig + (yAvg - yOrig) * lumaBlend;
                const newCb = cbOrig + (cbAvg - cbOrig) * chromaBlend;
                const newCr = crOrig + (crAvg - crOrig) * chromaBlend;

                // Conversion inverse YCbCr -> RVB
                const outR = newY + 1.402 * newCr;
                const outG = newY - 0.344136 * newCb - 0.714136 * newCr;
                const outB = newY + 1.772 * newCb;

                data[i]     = Math.min(255, Math.max(0, outR));
                data[i + 1] = Math.min(255, Math.max(0, outG));
                data[i + 2] = Math.min(255, Math.max(0, outB));
            }
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.DenoiseFilter = DenoiseFilter;
}