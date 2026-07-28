/*=========================================================
    Nikon Picture Control Studio - Brightness Filter
=========================================================*/

class BrightnessFilter {
    process(imageData, settings) {
        // Accepte settings.brightness ou fallback
        const brightnessVal = settings.brightness ?? 0;

        // Si la valeur est 0, on ne modifie aucun pixel (performance max)
        if (brightnessVal === 0) return imageData;

        const data = imageData.data;
        const len = data.length;

        // Conversion du slider (-1.5 à +1.5) en gain d'exposition (-38 à +38 niveaux RVB)
        const factor = brightnessVal * 25.5;

        for (let i = 0; i < len; i += 4) {
            // Application du décalage de luminosité avec saturation (0..255)
            data[i]     = Math.min(255, Math.max(0, data[i] + factor));     // R
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + factor)); // G
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + factor)); // B
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.BrightnessFilter = BrightnessFilter;
}