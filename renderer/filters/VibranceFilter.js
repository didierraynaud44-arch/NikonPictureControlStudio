/*=========================================================
    Nikon Picture Control Studio - Vibrance Filter
=========================================================*/

class VibranceFilter {
    process(imageData, settings) {
        const val = settings.vibrance ?? 0;
        if (val === 0) return imageData;

        const data = imageData.data;
        const len = data.length;
        const amount = val * 0.2;

        for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const max = Math.max(r, g, b);
            const avg = (r + g + b) / 3;
            const sat = (max - avg) / 255;

            // Plus la couleur est terne, plus l'effet est prononcé
            const boost = (1 - sat) * amount;

            data[i]     = Math.min(255, Math.max(0, r + (r - avg) * boost));
            data[i + 1] = Math.min(255, Math.max(0, g + (g - avg) * boost));
            data[i + 2] = Math.min(255, Math.max(0, b + (b - avg) * boost));
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.VibranceFilter = VibranceFilter;
}