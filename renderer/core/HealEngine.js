/*=========================================================
    Pixel RAW - Heal Engine
    Copie de pixels décalée (tampon de duplication), avec fusion
    de Poisson optionnelle pour raccorder proprement la zone
    source à la zone de destination (luminosité/couleur différentes).
=========================================================*/

class HealEngine {

    /**
     * Bounding box (en pixels image) des positions où alpha > threshold.
     * @private
     */
    static _alphaBoundingBox(alpha, width, height, threshold = 0.01) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (let y = 0; y < height; y++) {
            const row = y * width;
            for (let x = 0; x < width; x++) {
                if (alpha[row + x] > threshold) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!isFinite(minX)) return null;
        return { minX, minY, maxX, maxY };
    }

    /**
     * Copie directe des pixels source (décalés de dx,dy) vers la destination,
     * pondérée par destMaskAlpha. Simple, sert de base/repli si la fusion de
     * Poisson échoue.
     */
    static cloneCopy(imageData, destMaskAlpha, dx, dy) {
        const width = imageData.width;
        const height = imageData.height;

        const bbox = HealEngine._alphaBoundingBox(destMaskAlpha, width, height);
        if (!bbox) return imageData;

        // Snapshot pris AVANT toute écriture : évite qu'une zone source qui
        // chevauche la destination ne lise des pixels déjà retouchés.
        const src = new Uint8ClampedArray(imageData.data);
        const dst = imageData.data;

        const ddx = Math.round(dx);
        const ddy = Math.round(dy);

        for (let y = bbox.minY; y <= bbox.maxY; y++) {
            for (let x = bbox.minX; x <= bbox.maxX; x++) {
                const idx = y * width + x;
                const a = destMaskAlpha[idx];
                if (a <= 0.01) continue;

                const sx = Math.min(width - 1, Math.max(0, x + ddx));
                const sy = Math.min(height - 1, Math.max(0, y + ddy));
                const sIdx = (sy * width + sx) * 4;
                const dIdx = idx * 4;

                dst[dIdx]     = dst[dIdx]     * (1 - a) + src[sIdx]     * a;
                dst[dIdx + 1] = dst[dIdx + 1] * (1 - a) + src[sIdx + 1] * a;
                dst[dIdx + 2] = dst[dIdx + 2] * (1 - a) + src[sIdx + 2] * a;
            }
        }

        return imageData;
    }

    /**
     * Fusion de Poisson discrète (Gauss-Seidel), canal par canal. Le champ
     * guide vient du GRADIENT de la zone source (pas de ses valeurs brutes) :
     * ça reproduit la texture source tout en laissant la fusion recaler le
     * niveau moyen (luminosité/teinte) sur son environnement de destination.
     */
    static poissonBlend(imageData, destMaskAlpha, dx, dy, iterations = 300) {
        const width = imageData.width;
        const height = imageData.height;

        const bbox = HealEngine._alphaBoundingBox(destMaskAlpha, width, height);
        if (!bbox) return imageData;

        const ddx = Math.round(dx);
        const ddy = Math.round(dy);

        // Snapshot pré-édition : sert à la fois de valeur de destination de
        // départ (bord = valeur actuelle, condition aux limites) et de source
        // pour le calcul du gradient.
        const srcSnapshot = new Uint8ClampedArray(imageData.data);

        const clampX = (x) => Math.min(width - 1, Math.max(0, x));
        const clampY = (y) => Math.min(height - 1, Math.max(0, y));
        const srcAt = (x, y, c) => srcSnapshot[(clampY(y) * width + clampX(x)) * 4 + c];
        const alphaAt = (x, y) => {
            if (x < 0 || x >= width || y < 0 || y >= height) return 0;
            return destMaskAlpha[y * width + x];
        };

        const { minX, minY, maxX, maxY } = bbox;
        const boxW = maxX - minX + 1;
        const boxH = maxY - minY + 1;
        const boxSize = boxW * boxH;

        const isInterior = new Uint8Array(boxSize);
        const guidance = [new Float32Array(boxSize), new Float32Array(boxSize), new Float32Array(boxSize)];
        const result = [new Float32Array(boxSize), new Float32Array(boxSize), new Float32Array(boxSize)];

        for (let by = 0; by < boxH; by++) {
            const y = minY + by;
            for (let bx = 0; bx < boxW; bx++) {
                const x = minX + bx;
                const bIdx = by * boxW + bx;
                const dIdx = (y * width + x) * 4;
                const a = destMaskAlpha[y * width + x];

                // Point de départ = valeur actuelle du pixel de destination.
                // Reste telle quelle pour les pixels de bordure (jamais mise
                // à jour par les itérations ci-dessous).
                result[0][bIdx] = srcSnapshot[dIdx];
                result[1][bIdx] = srcSnapshot[dIdx + 1];
                result[2][bIdx] = srcSnapshot[dIdx + 2];

                if (a <= 0.01) {
                    isInterior[bIdx] = 0;
                    continue;
                }

                const interior = (
                    alphaAt(x - 1, y) > 0.01 &&
                    alphaAt(x + 1, y) > 0.01 &&
                    alphaAt(x, y - 1) > 0.01 &&
                    alphaAt(x, y + 1) > 0.01
                );
                isInterior[bIdx] = interior ? 1 : 0;
                if (!interior) continue;

                const sx = x + ddx;
                const sy = y + ddy;
                for (let c = 0; c < 3; c++) {
                    const center = srcAt(sx, sy, c);
                    const up    = srcAt(sx, sy - 1, c);
                    const down  = srcAt(sx, sy + 1, c);
                    const left  = srcAt(sx - 1, sy, c);
                    const right = srcAt(sx + 1, sy, c);
                    guidance[c][bIdx] = 4 * center - (up + down + left + right);
                }
            }
        }

        for (let it = 0; it < iterations; it++) {
            for (let by = 0; by < boxH; by++) {
                const rowIdx = by * boxW;
                for (let bx = 0; bx < boxW; bx++) {
                    const bIdx = rowIdx + bx;
                    if (!isInterior[bIdx]) continue;

                    for (let c = 0; c < 3; c++) {
                        const r = result[c];
                        const up    = r[bIdx - boxW];
                        const down  = r[bIdx + boxW];
                        const left  = r[bIdx - 1];
                        const right = r[bIdx + 1];
                        let v = (up + down + left + right + guidance[c][bIdx]) / 4;
                        if (v < 0) v = 0; else if (v > 255) v = 255;
                        r[bIdx] = v;
                    }
                }
            }
        }

        // Composite final : mélange original/résultat selon l'alpha (les
        // pixels de bordure ont result === original, donc ce blend ne les
        // change pas — transition douce automatique aux bords du pinceau).
        const dst = imageData.data;
        for (let by = 0; by < boxH; by++) {
            const y = minY + by;
            for (let bx = 0; bx < boxW; bx++) {
                const x = minX + bx;
                const idx = y * width + x;
                const a = destMaskAlpha[idx];
                if (a <= 0.01) continue;

                const bIdx = by * boxW + bx;
                const dIdx = idx * 4;

                dst[dIdx]     = srcSnapshot[dIdx]     * (1 - a) + result[0][bIdx] * a;
                dst[dIdx + 1] = srcSnapshot[dIdx + 1] * (1 - a) + result[1][bIdx] * a;
                dst[dIdx + 2] = srcSnapshot[dIdx + 2] * (1 - a) + result[2][bIdx] * a;
            }
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.HealEngine = HealEngine;
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = HealEngine;
}
