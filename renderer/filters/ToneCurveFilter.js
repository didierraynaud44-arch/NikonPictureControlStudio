/*=========================================================
    Nikon Picture Control Studio - Tone Curve Filter
=========================================================*/

class ToneCurveFilter {
    process(imageData, settings) {
        // LUT transmise depuis l'IHM (tableau de 256 valeurs de 0 à 255)
        const lut = settings.toneCurveLut;
        if (!lut || lut.length !== 256) return imageData;

        const data = imageData.data;
        const len = data.length;

        for (let i = 0; i < len; i += 4) {
            data[i]     = lut[data[i]];     // Red
            data[i + 1] = lut[data[i + 1]]; // Green
            data[i + 2] = lut[data[i + 2]]; // Blue
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.ToneCurveFilter = ToneCurveFilter;
}