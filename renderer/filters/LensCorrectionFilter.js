/*=========================================================
    Nikon Picture Control Studio - Lens Correction Filter
=========================================================*/

class LensCorrectionFilter {
    constructor() {
        this.profiles = null;
        this.loadProfiles();
    }

    async loadProfiles() {
        try {
            const response = await fetch("../assets/lensProfiles.json");
            if (response.ok) {
                this.profiles = await response.json();
            }
        } catch (e) {
            console.warn("⚠️ Impossible de charger lensProfiles.json, utilisation des valeurs par défaut.");
        }
    }

    /**
     * Extrait le coefficient de distorsion k1 selon l'objectif et la focale
     */
    getDistortionCoeff(lensName, focal) {
        if (!this.profiles || !lensName) return -0.02; // Fallback barillet doux

        const profile = this.profiles[lensName];
        if (!profile || !profile.distortion) {
            return this.profiles.DEFAULT_BARREL.distortion;
        }

        const focals = Object.keys(profile.distortion).map(Number).sort((a, b) => a - b);
        if (focals.length === 0) return 0;

        // Focale exacte ou la plus proche
        const closestFocal = focals.reduce((prev, curr) => 
            Math.abs(curr - focal) < Math.abs(prev - focal) ? curr : prev
        );

        return profile.distortion[closestFocal] ?? 0;
    }

    process(imageData, settings) {
        if (!settings.lensCorrection) return imageData;

        const lensInfo = settings.lensInfo || {};
        const lensName = lensInfo.model || settings.lens;
        const focal = parseFloat(lensInfo.focalLength) || 35;

        const k1 = this.getDistortionCoeff(lensName, focal);
        if (k1 === 0) return imageData;

        const srcData = imageData.data;
        const width = imageData.width;
        const height = imageData.height;

        const outCanvas = document.createElement("canvas");
        outCanvas.width = width;
        outCanvas.height = height;
        const outCtx = outCanvas.getContext("2d");
        const outImageData = outCtx.createImageData(width, height);
        const dstData = outImageData.data;

        const centerX = width / 2;
        const centerY = height / 2;
        const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dstIdx = (y * width + x) * 4;

                // Coordonnées normalisées (-1 à +1)
                const normX = (x - centerX) / maxRadius;
                const normY = (y - centerY) / maxRadius;
                const r2 = normX * normX + normY * normY;

                // Modèle de distorsion Brown-Conrady : r_src = r * (1 + k1 * r^2)
                const factor = 1 + k1 * r2;
                const srcX = centerX + normX * factor * maxRadius;
                const srcY = centerY + normY * factor * maxRadius;

                // Interpolation bilinéaire
                if (srcX >= 0 && srcX < width - 1 && srcY >= 0 && srcY < height - 1) {
                    const x0 = Math.floor(srcX);
                    const y0 = Math.floor(srcY);
                    const x1 = x0 + 1;
                    const y1 = y0 + 1;

                    const wx1 = srcX - x0;
                    const wx0 = 1 - wx1;
                    const wy1 = srcY - y0;
                    const wy0 = 1 - wy1;

                    const idx00 = (y0 * width + x0) * 4;
                    const idx10 = (y0 * width + x1) * 4;
                    const idx01 = (y1 * width + x0) * 4;
                    const idx11 = (y1 * width + x1) * 4;

                    for (let c = 0; c < 3; c++) {
                        dstData[dstIdx + c] = 
                            wy0 * (wx0 * srcData[idx00 + c] + wx1 * srcData[idx10 + c]) +
                            wy1 * (wx0 * srcData[idx01 + c] + wx1 * srcData[idx11 + c]);
                    }
                    dstData[dstIdx + 3] = 255; // Alpha
                } else {
                    // Hors cadre : transparent/noir
                    dstData[dstIdx + 3] = 0;
                }
            }
        }

        return outImageData;
    }
}

if (typeof window !== "undefined") {
    window.LensCorrectionFilter = LensCorrectionFilter;
}