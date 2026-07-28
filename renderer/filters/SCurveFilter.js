/*=========================================================
    Nikon Picture Control Studio - S-Curve Filter
=========================================================*/

class SCurveFilter {
    process(imageData, settings) {
        const val = settings.sCurve ?? 0;
        if (val === 0) return imageData;

        const data = imageData.data;
        const len = data.length;
        const strength = val * 0.4;

        for (let i = 0; i < len; i += 4) {
            for (let c = 0; c < 3; c++) {
                const norm = data[i + c] / 255;
                // Courbe sigmoïde douce basée sur le cosinus
                const sCurve = (1 - Math.cos(norm * Math.PI)) / 2;
                const result = norm + (sCurve - norm) * strength;
                data[i + c] = Math.min(255, Math.max(0, result * 255));
            }
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.SCurveFilter = SCurveFilter;
}