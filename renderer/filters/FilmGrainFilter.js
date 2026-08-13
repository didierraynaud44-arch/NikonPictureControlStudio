/*=========================================================
    Pixel RAW - Simulation Pellicule : Grain
=========================================================*/

class FilmGrainFilter {
    apply(imageData, settings) {
        const intensity = settings.grainIntensity ?? 0;
        if (!intensity) return imageData;

        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;

        // 🔹 Bruit généré à basse résolution (1 échantillon pour grainSize² pixels
        // réels) puis ré-agrandi par interpolation bilinéaire, pour obtenir des
        // "grains" de la bonne taille visuelle plutôt qu'un bruit pixel par pixel
        // (effet neige TV).
        const grainSize = Math.max(1, settings.grainSize ?? 1);
        const noiseW = Math.max(1, Math.ceil(width / grainSize) + 1);
        const noiseH = Math.max(1, Math.ceil(height / grainSize) + 1);

        const noise = new Float32Array(noiseW * noiseH);
        for (let i = 0; i < noise.length; i++) {
            // Somme de deux tirages uniformes = distribution triangulaire, plus
            // proche d'un grain argentique qu'un bruit uniforme pur.
            noise[i] = Math.random() + Math.random() - 1;
        }

        const strength = (intensity / 100) * 45;

        for (let y = 0; y < height; y++) {
            const gy = y / grainSize;
            const y0 = Math.floor(gy);
            const y1 = Math.min(noiseH - 1, y0 + 1);
            const fy = gy - y0;

            for (let x = 0; x < width; x++) {
                const gx = x / grainSize;
                const x0 = Math.floor(gx);
                const x1 = Math.min(noiseW - 1, x0 + 1);
                const fx = gx - x0;

                const n00 = noise[y0 * noiseW + x0];
                const n10 = noise[y0 * noiseW + x1];
                const n01 = noise[y1 * noiseW + x0];
                const n11 = noise[y1 * noiseW + x1];
                const top = n00 + (n10 - n00) * fx;
                const bottom = n01 + (n11 - n01) * fx;
                const n = top + (bottom - top) * fy;

                const i = (y * width + x) * 4;
                const r = data[i], g = data[i + 1], b = data[i + 2];

                // Modulation par luminance : bien visible dans les ombres/tons
                // moyens, atténué dans les hautes lumières (courbe simple, un
                // plancher évite un arrêt trop net près du blanc).
                const lumNorm = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                const mask = Math.max(0.15, 1 - Math.pow(lumNorm, 1.8));

                // Même valeur de bruit sur R/G/B (grain mono, pas de bruit chromatique).
                const delta = n * strength * mask;

                data[i]     = Math.max(0, Math.min(255, r + delta));
                data[i + 1] = Math.max(0, Math.min(255, g + delta));
                data[i + 2] = Math.max(0, Math.min(255, b + delta));
            }
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.FilmGrainFilter = FilmGrainFilter;
}
