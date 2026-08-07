/*=========================================================
    Nikon Picture Control Studio - White Balance Filter
=========================================================*/

class WhiteBalanceFilter {
    constructor() {
        this.name = "WhiteBalanceFilter";
    }

    process(imageData, pc) {
        if (!pc) return imageData;

        // Récupération de la température (-100 à +100 ou Température Kelvin)
        // et de la teinte / Tint (-100 à +100)
        const temperature = pc.wbTemperature ?? 0; // -100 (Froid/Bleu) à +100 (Chaud/Jaune)
        const tint = pc.wbTint ?? 0;               // -100 (Vert) à +100 (Magenta)

        if (temperature === 0 && tint === 0) return imageData;

        const data = imageData.data;
        const len = data.length;

        // Calcul des facteurs d'ajustement RVB
        const rFactor = 1 + (temperature * 0.005) + (tint * 0.002);
        const gFactor = 1 - (tint * 0.005);
        const bFactor = 1 - (temperature * 0.005) + (tint * 0.002);

        for (let i = 0; i < len; i += 4) {
            // Application des gains
            let r = data[i] * rFactor;
            let g = data[i + 1] * gFactor;
            let b = data[i + 2] * bFactor;

            // Clamping 0-255
            data[i]     = r > 255 ? 255 : (r < 0 ? 0 : r);
            data[i + 1] = g > 255 ? 255 : (g < 0 ? 0 : g);
            data[i + 2] = b > 255 ? 255 : (b < 0 ? 0 : b);
        }

        return imageData;
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = WhiteBalanceFilter;
}