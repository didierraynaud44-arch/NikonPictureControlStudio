/*=========================================================
    Nikon Picture Control Studio - Dehaze Filter
=========================================================*/

class DehazeFilter {
    process(imageData, settings) {
        const val = settings.dehaze ?? 0;
        if (val === 0) return imageData;

        const data = imageData.data;
        const len = data.length;
        const factor = val * 0.12;

        for (let i = 0; i < len; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            // Estimation du canal sombre (airlight)
            const minChan = Math.min(r, g, b);
            const transmission = Math.max(0.1, 1.0 - (factor * (minChan / 255)));

            // Restauration du contraste et de la clarté
            r = (r - 255 * (1 - transmission)) / transmission;
            g = (g - 255 * (1 - transmission)) / transmission;
            b = (b - 255 * (1 - transmission)) / transmission;

            data[i]     = Math.min(255, Math.max(0, r));
            data[i + 1] = Math.min(255, Math.max(0, g));
            data[i + 2] = Math.min(255, Math.max(0, b));
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.DehazeFilter = DehazeFilter;
}