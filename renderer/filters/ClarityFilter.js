class ClarityFilter {
    constructor() {
        this.name = "Clarity";
    }

    apply(imageData, pc) {
        // 1. Récupération de la valeur du slider (-5 à +5)
        const clarity = pc ? (pc.clarity ?? 0) : 0;

        // Si la clarté est à zéro, on ne fait aucun calcul
        if (clarity === 0) return imageData;

        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;

        // 2. Facteur d'intensité (Ajustable pour accentuer ou adoucir le rendu)
        const factor = (clarity / 5) * 0.35; 

        // 3. Calcul du micro-contraste par échantillonnage local rapide (Fast Local Contrast)
        const step = Math.max(2, Math.round(width / 400)); // Échantillonne les pixels voisins pour extraire les fréquences moyennes

        for (let y = step; y < height - step; y += 1) {
            for (let x = step; x < width - step; x += 1) {
                const idx = (y * width + x) * 4;

                // Extraction de la moyenne locale (voisinage)
                const leftIdx = (y * width + (x - step)) * 4;
                const rightIdx = (y * width + (x + step)) * 4;
                const topIdx = ((y - step) * width + x) * 4;
                const bottomIdx = ((y + step) * width + x) * 4;

                const localAvgR = (data[leftIdx] + data[rightIdx] + data[topIdx] + data[bottomIdx]) / 4;
                const localAvgG = (data[leftIdx + 1] + data[rightIdx + 1] + data[topIdx + 1] + data[bottomIdx + 1]) / 4;
                const localAvgB = (data[leftIdx + 2] + data[rightIdx + 2] + data[topIdx + 2] + data[bottomIdx + 2]) / 4;

                // Application de l'accentuation des fréquences moyennes sur R, G, B
                data[idx]     = Math.min(255, Math.max(0, data[idx]     + (data[idx]     - localAvgR) * factor));
                data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1] + (data[idx + 1] - localAvgG) * factor));
                data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2] + (data[idx + 2] - localAvgB) * factor));
            }
        }

        return imageData;
    }
}

window.ClarityFilter = ClarityFilter;