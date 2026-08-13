/*=========================================================
    Pixel RAW - Simulation Pellicule : Halation
=========================================================*/

class HalationFilter {
    apply(imageData, settings) {
        const intensity = settings.halationIntensity ?? 0;
        if (!intensity) return imageData;

        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;

        const threshold = settings.halationThreshold ?? 200;
        const radius = Math.max(1, Math.round(settings.halationRadius ?? 8));

        // 1. Carte des hautes lumières (luminance uniquement, normalisée 0-1
        // au-dessus du seuil).
        const pixelCount = width * height;
        let highlightMap = new Float32Array(pixelCount);
        const range = Math.max(1, 255 - threshold);
        for (let p = 0, i = 0; i < data.length; i += 4, p++) {
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            highlightMap[p] = lum > threshold ? (lum - threshold) / range : 0;
        }

        // 2. Flou gaussien simple : approximation par 3 passes de flou de
        // moyenne (box blur) horizontal + vertical, via sommes préfixes pour
        // rester efficace quel que soit le rayon.
        for (let pass = 0; pass < 3; pass++) {
            highlightMap = this._boxBlur1D(highlightMap, width, height, radius, true);
            highlightMap = this._boxBlur1D(highlightMap, width, height, radius, false);
        }

        // 3. Teinte rouge-orangé caractéristique de l'halation argentique,
        // fusionnée en mode ÉCRAN, pondérée par l'intensité réglée.
        const [hr, hg, hb] = [255, 80, 30];
        const amount = Math.max(0, Math.min(100, intensity)) / 100;

        for (let p = 0, i = 0; i < data.length; i += 4, p++) {
            const a = highlightMap[p] * amount;
            if (a <= 0) continue;

            const haloR = hr * a;
            const haloG = hg * a;
            const haloB = hb * a;

            data[i]     = 255 - (255 - data[i])     * (255 - haloR) / 255;
            data[i + 1] = 255 - (255 - data[i + 1]) * (255 - haloG) / 255;
            data[i + 2] = 255 - (255 - data[i + 2]) * (255 - haloB) / 255;
        }

        return imageData;
    }

    /**
     * Flou de moyenne 1D (horizontal ou vertical) via sommes préfixes par
     * ligne/colonne, bords gérés par recadrage de la fenêtre (pas de halo
     * artificiel sur les bords de l'image).
     * @private
     */
    _boxBlur1D(src, width, height, radius, horizontal) {
        const out = new Float32Array(src.length);

        if (horizontal) {
            const prefix = new Float32Array(width + 1);
            for (let y = 0; y < height; y++) {
                const base = y * width;
                prefix[0] = 0;
                for (let x = 0; x < width; x++) prefix[x + 1] = prefix[x] + src[base + x];
                for (let x = 0; x < width; x++) {
                    const x0 = Math.max(0, x - radius);
                    const x1 = Math.min(width - 1, x + radius);
                    out[base + x] = (prefix[x1 + 1] - prefix[x0]) / (x1 - x0 + 1);
                }
            }
        } else {
            const prefix = new Float32Array(height + 1);
            for (let x = 0; x < width; x++) {
                prefix[0] = 0;
                for (let y = 0; y < height; y++) prefix[y + 1] = prefix[y] + src[y * width + x];
                for (let y = 0; y < height; y++) {
                    const y0 = Math.max(0, y - radius);
                    const y1 = Math.min(height - 1, y + radius);
                    out[y * width + x] = (prefix[y1 + 1] - prefix[y0]) / (y1 - y0 + 1);
                }
            }
        }

        return out;
    }
}

if (typeof window !== "undefined") {
    window.HalationFilter = HalationFilter;
}
