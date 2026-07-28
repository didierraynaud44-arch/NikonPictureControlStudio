/*=========================================================
    Nikon Picture Control Studio - Monochrome Filter
=========================================================*/

class MonochromeFilter extends BaseFilter {
    constructor() {
        super("monochrome");
        
        // Poids des filtres optiques Nikon (R, G, B)
        this.filterMatrices = {
            OFF:    [0.299, 0.587, 0.114],
            YELLOW: [0.450, 0.500, 0.050],
            ORANGE: [0.650, 0.320, 0.030],
            RED:    [0.850, 0.120, 0.030],
            GREEN:  [0.150, 0.750, 0.100]
        };

        // Teintes de virage (RGB normalisés)
        this.toningColors = {
            "B&W":       [0, 0, 0],
            "SEPIA":     [1.10, 0.95, 0.80],
            "CYANOTYPE": [0.80, 0.95, 1.15],
            "VIOLET":    [1.05, 0.85, 1.10],
            "RED":       [1.15, 0.85, 0.85],
            "GREEN":     [0.85, 1.10, 0.85],
            "BLUE":      [0.85, 0.95, 1.15]
        };
    }

    apply(imageData, params) {
        if (!imageData) return imageData;

        // Active le filtre si c'est un profil Monochrome ou si isMonochrome est vrai
        const isMono = params && (
            params.isMonochrome === true || 
            params.pictureControlName === "Monochrome" || 
            params.name === "Monochrome" ||
            params.pictureControlName === "MC" ||
            params.name === "MC"
        );

        if (!isMono) return imageData;

        const data = imageData.data;
        const len = data.length;

        const filterType = params.filterEffect || "OFF";
        const [wR, wG, wB] = this.filterMatrices[filterType] || this.filterMatrices.OFF;

        const toningType = params.toningEffect || "B&W";
        const toningIntensity = typeof params.toningAmount === "number" ? params.toningAmount : 0; // 0 à 7
        const [tR, tG, tB] = this.toningColors[toningType] || this.toningColors["B&W"];

        const factor = (toningIntensity / 7);

        for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // 1. Conversion N&B selon le filtre optique choisi
            let gray = r * wR + g * wG + b * wB;

            if (gray > 255) gray = 255;
            if (gray < 0) gray = 0;

            // 2. Virage éventuel
            if (toningType !== "B&W" && toningIntensity > 0) {
                data[i]     = Math.min(255, gray * (1 + (tR - 1) * factor));
                data[i + 1] = Math.min(255, gray * (1 + (tG - 1) * factor));
                data[i + 2] = Math.min(255, gray * (1 + (tB - 1) * factor));
            } else {
                data[i]     = gray;
                data[i + 1] = gray;
                data[i + 2] = gray;
            }
        }

        return imageData;
    }
}

window.MonochromeFilter = MonochromeFilter;