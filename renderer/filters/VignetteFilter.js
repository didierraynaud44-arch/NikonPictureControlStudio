/*=========================================================
    Nikon Picture Control Studio - Vignette Filter
=========================================================*/

class VignetteFilter {
    process(imageData, settings) {
        const val = settings.vignette ?? 0;
        if (val === 0) return imageData;

        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;

        const centerX = width / 2;
        const centerY = height / 2;
        const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
        const factor = val * 0.15;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;

                const dx = x - centerX;
                const dy = y - centerY;
                const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;

                // Atténuation logarithmique vers les bords
                const falloff = Math.pow(dist, 2) * factor;
                const mult = Math.max(0, 1 - falloff);

                data[i]     = Math.min(255, Math.max(0, data[i] * mult));
                data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * mult));
                data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * mult));
            }
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.VignetteFilter = VignetteFilter;
}