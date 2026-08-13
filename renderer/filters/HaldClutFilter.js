/*=========================================================
    Pixel RAW - Simulation Pellicule : Hald-CLUT
    (réponse colorimétrique pellicule, via table de correspondance
    couleur importée depuis un fichier PNG Hald-CLUT)
=========================================================*/

class HaldClutFilter {
    apply(imageData, settings) {
        const intensity = settings.haldClutIntensity ?? 0;
        const lut = settings.haldClutData;
        if (!lut || !intensity) return imageData;

        const side = settings.haldClutSide || lut.width;
        // 🔹 Convention standard Hald-CLUT (ImageMagick/RawTherapee/GIMP) :
        // pour un LUT de "niveau" N, l'image fait N³ pixels de côté et encode
        // un cube couleur de N² pas par canal.
        const level = Math.round(Math.cbrt(side));
        const cubeSize = level * level;
        if (!Number.isFinite(cubeSize) || cubeSize < 2) return imageData;

        const maxIndex = cubeSize - 1;
        const amount = Math.max(0, Math.min(100, intensity)) / 100;

        const lutData = lut.data;
        const data = imageData.data;
        const len = data.length;

        const cubeSize2 = cubeSize * cubeSize;
        const idxOf = (ir, ig, ib) => {
            const pixelIndex = ir + ig * cubeSize + ib * cubeSize2;
            const px = pixelIndex % side;
            const py = (pixelIndex / side) | 0;
            return (py * side + px) * 4;
        };

        for (let i = 0; i < len; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];

            // Coordonnées flottantes dans la grille du cube couleur (0..maxIndex)
            const fr = (r / 255) * maxIndex;
            const fg = (g / 255) * maxIndex;
            const fb = (b / 255) * maxIndex;

            const ir0 = Math.floor(fr), ir1 = Math.min(maxIndex, ir0 + 1), tr = fr - ir0;
            const ig0 = Math.floor(fg), ig1 = Math.min(maxIndex, ig0 + 1), tg = fg - ig0;
            const ib0 = Math.floor(fb), ib1 = Math.min(maxIndex, ib0 + 1), tb = fb - ib0;

            // Interpolation trilinéaire entre les 8 coins du cube (rendu lisse,
            // sans les marches d'escalier d'un plus-proche-voisin).
            const o000 = idxOf(ir0, ig0, ib0);
            const o100 = idxOf(ir1, ig0, ib0);
            const o010 = idxOf(ir0, ig1, ib0);
            const o110 = idxOf(ir1, ig1, ib0);
            const o001 = idxOf(ir0, ig0, ib1);
            const o101 = idxOf(ir1, ig0, ib1);
            const o011 = idxOf(ir0, ig1, ib1);
            const o111 = idxOf(ir1, ig1, ib1);

            for (let c = 0; c < 3; c++) {
                const c00 = lutData[o000 + c] + (lutData[o100 + c] - lutData[o000 + c]) * tr;
                const c10 = lutData[o010 + c] + (lutData[o110 + c] - lutData[o010 + c]) * tr;
                const c01 = lutData[o001 + c] + (lutData[o101 + c] - lutData[o001 + c]) * tr;
                const c11 = lutData[o011 + c] + (lutData[o111 + c] - lutData[o011 + c]) * tr;

                const c0 = c00 + (c10 - c00) * tg;
                const c1 = c01 + (c11 - c01) * tg;
                const outVal = c0 + (c1 - c0) * tb;

                const orig = data[i + c];
                data[i + c] = orig + (outVal - orig) * amount;
            }
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.HaldClutFilter = HaldClutFilter;
}
