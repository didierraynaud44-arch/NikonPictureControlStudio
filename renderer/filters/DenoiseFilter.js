/*=========================================================
    Nikon Picture Control Studio - Denoise Filter
=========================================================*/

class DenoiseFilter {
    process(imageData, settings) {
        const val = settings.denoise ?? 0;
        if (val === 0) return imageData;

        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const threshold = val * 12;

        const copy = new Uint8ClampedArray(data);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = (y * width + x) * 4;

                for (let c = 0; c < 3; c++) {
                    const current = copy[i + c];
                    const left    = copy[i - 4 + c];
                    const right   = copy[i + 4 + c];
                    const top     = copy[i - width * 4 + c];
                    const bottom  = copy[i + width * 4 + c];

                    const avg = (left + right + top + bottom) / 4;

                    // Si l'écart est faible (bruit), on lisse. Si grand (contour), on conserve.
                    if (Math.abs(current - avg) < threshold) {
                        data[i + c] = avg;
                    }
                }
            }
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.DenoiseFilter = DenoiseFilter;
}