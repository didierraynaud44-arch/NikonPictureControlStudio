/*=========================================================
    Pixel RAW - Perspective Engine
    Correction de perspective par homographie (DLT, 4 points), warp inverse
    avec interpolation bilinéaire réutilisant LensCorrectionFilter (même
    convention : bords écrêtés/clamp, pas de bord transparent).

    Convention des coins : ordre FIXE [tl, tr, bl, br] (haut-gauche,
    haut-droite, bas-gauche, bas-droite), coordonnées normalisées [0,1]
    relatives à l'image sur laquelle la correction est appliquée.
=========================================================*/

const PerspectiveEngine = (function () {

    /**
     * Résout Ax=b par élimination de Gauss-Jordan avec pivot partiel (matrice
     * réduite à l'identité, x lu directement dans la dernière colonne — plus
     * simple qu'une remontée explicite, coût négligeable pour un système 8×8).
     * A : tableau de n tableaux de n nombres (copié, jamais muté). b : n nombres.
     * @returns {number[]|null} x, ou null si le système est singulier (points dégénérés).
     */
    function solveLinearSystem(A, b) {
        const n = b.length;
        const M = A.map((row, i) => [...row, b[i]]);

        for (let col = 0; col < n; col++) {
            let pivotRow = col;
            let maxAbs = Math.abs(M[col][col]);
            for (let r = col + 1; r < n; r++) {
                if (Math.abs(M[r][col]) > maxAbs) {
                    maxAbs = Math.abs(M[r][col]);
                    pivotRow = r;
                }
            }
            if (maxAbs < 1e-12) return null;

            if (pivotRow !== col) {
                const tmp = M[col]; M[col] = M[pivotRow]; M[pivotRow] = tmp;
            }

            const pivotVal = M[col][col];
            for (let c = col; c <= n; c++) M[col][c] /= pivotVal;

            for (let r = 0; r < n; r++) {
                if (r === col) continue;
                const factor = M[r][col];
                if (factor === 0) continue;
                for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
            }
        }

        return M.map(row => row[n]);
    }

    /**
     * DLT vérifiée avant implémentation (voir plan) : pour chaque
     * correspondance (x,y)->(x',y'), deux lignes dans A·h=0. Avec EXACTEMENT
     * 4 points (notre cas), h33 fixé à 1 et le système 8×8 résultant résolu
     * directement — plus simple qu'une SVD, valide tant qu'aucun point n'est
     * à l'infini (jamais le cas ici, 4 coins d'une photo).
     * @param {{x:number,y:number}[]} srcPoints - 4 points, mêmes unités que dstPoints (pixels)
     * @param {{x:number,y:number}[]} dstPoints - 4 points
     * @returns {number[][]} matrice 3×3 [[h11,h12,h13],[h21,h22,h23],[h31,h32,1]]
     */
    function computeHomography(srcPoints, dstPoints) {
        if (!srcPoints || !dstPoints || srcPoints.length !== 4 || dstPoints.length !== 4) {
            throw new Error("computeHomography nécessite exactement 4 points source et 4 points destination");
        }

        const A = [];
        const b = [];
        for (let i = 0; i < 4; i++) {
            const x = srcPoints[i].x, y = srcPoints[i].y;
            const xp = dstPoints[i].x, yp = dstPoints[i].y;

            A.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp]);
            b.push(xp);

            A.push([0, 0, 0, x, y, 1, -x * yp, -y * yp]);
            b.push(yp);
        }

        const h = solveLinearSystem(A, b);
        if (!h) throw new Error("Points de perspective dégénérés (colinéaires ou confondus) : homographie non calculable");

        return [
            [h[0], h[1], h[2]],
            [h[3], h[4], h[5]],
            [h[6], h[7], 1]
        ];
    }

    /**
     * Inverse d'une matrice 3×3 (formule standard par cofacteurs/adjugate).
     * @param {number[][]} H
     * @returns {number[][]}
     */
    function invertHomography(H) {
        const a = H[0][0], b = H[0][1], c = H[0][2];
        const d = H[1][0], e = H[1][1], f = H[1][2];
        const g = H[2][0], h = H[2][1], i = H[2][2];

        const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        if (Math.abs(det) < 1e-12) {
            throw new Error("Homographie non inversible (déterminant nul)");
        }
        const invDet = 1 / det;

        return [
            [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
            [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
            [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet]
        ];
    }

    /**
     * Applique H à imageData : pour chaque pixel de SORTIE, calcule sa
     * position SOURCE via H⁻¹ (warp inverse — c'est le sens correct pour ne
     * jamais laisser de trou dans le résultat), échantillonne avec
     * LensCorrectionFilter._bilinearChannel (bords écrêtés, pas de
     * transparence — même convention que la correction d'objectif).
     * H doit être exprimée dans les MÊMES unités que les dimensions de
     * imageData (pixels), pas en coordonnées normalisées.
     * @param {ImageData} imageData
     * @param {number[][]} H
     * @returns {ImageData}
     */
    function applyPerspectiveWarp(imageData, H) {
        const Hinv = invertHomography(H);
        const width = imageData.width;
        const height = imageData.height;
        const srcData = imageData.data;
        const outData = new Uint8ClampedArray(srcData.length);

        const a = Hinv[0][0], b = Hinv[0][1], c = Hinv[0][2];
        const d = Hinv[1][0], e = Hinv[1][1], f = Hinv[1][2];
        const g = Hinv[2][0], h = Hinv[2][1], i = Hinv[2][2];

        for (let oy = 0; oy < height; oy++) {
            for (let ox = 0; ox < width; ox++) {
                const w = g * ox + h * oy + i;
                const sx = (a * ox + b * oy + c) / w;
                const sy = (d * ox + e * oy + f) / w;

                const dstIdx = (oy * width + ox) * 4;
                outData[dstIdx]     = LensCorrectionFilter._bilinearChannel(srcData, width, height, sx, sy, 0);
                outData[dstIdx + 1] = LensCorrectionFilter._bilinearChannel(srcData, width, height, sx, sy, 1);
                outData[dstIdx + 2] = LensCorrectionFilter._bilinearChannel(srcData, width, height, sx, sy, 2);
                outData[dstIdx + 3] = 255;
            }
        }

        return new ImageData(outData, width, height);
    }

    /**
     * Point d'entrée principal : corrige imageData à partir des 4 coins
     * (normalisés [0,1], ordre [tl,tr,bl,br]) positionnés par l'utilisateur
     * sur un élément qui devrait être rectangulaire — mappe ces 4 points vers
     * les 4 vrais coins du rectangle imageData. No-op si corners absent.
     * @param {ImageData} imageData
     * @param {{x:number,y:number}[]} corners - 4 points normalisés [tl,tr,bl,br]
     * @returns {ImageData}
     */
    function applyPerspective(imageData, corners) {
        if (!corners || corners.length !== 4) return imageData;

        const w = imageData.width, h = imageData.height;
        const srcPoints = corners.map(p => ({ x: p.x * w, y: p.y * h }));
        const dstPoints = [
            { x: 0, y: 0 }, { x: w, y: 0 },
            { x: 0, y: h }, { x: w, y: h }
        ];

        const H = computeHomography(srcPoints, dstPoints);
        return applyPerspectiveWarp(imageData, H);
    }

    return { computeHomography, invertHomography, applyPerspectiveWarp, applyPerspective };
})();

if (typeof window !== "undefined") {
    window.PerspectiveEngine = PerspectiveEngine;
}
