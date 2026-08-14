/*=========================================================
    Pixel RAW - Correction d'objectif (distorsion, TCA, vignettage)

    Réimplémentation JavaScript des formules de correction Lensfun (pas la
    bibliothèque C++, licence LGPL, qu'on n'utilise pas — juste sa base de
    données XML, CC BY-SA 3.0, voir assets/lens-database/NOTICE) à partir des
    formules exactes de libs/lensfun/{mod-coord,mod-subpix,mod-color}.cpp.

    Simplification délibérée par rapport à Lensfun : chaque modèle est évalué
    directement dans son système de coordonnées natif (voir modifier.cpp,
    commentaire "About coordinate systems"), sans la conversion vers le
    système "natural" unifié de Lensfun (rescale_polynomial_coefficients,
    RealFocal vs focale nominale). Suffisant pour une correction ponctuelle
    indépendante ; pas composé avec d'autres transformations géométriques.

    - DISTORSION (ptlens/poly3/poly5) : système Hugin, r=1 à la demi-hauteur
      de l'image (petit côté en paysage). ptlens est le modèle DOMINANT dans
      les vraies données Nikon/Canon/Sony (5428 occurrences dans la base
      contre 869 pour poly3) — implémenté en plus de poly3.
    - ABERRATION CHROMATIQUE LATÉRALE (poly3, y compris "linear" normalisé
      vers la même représentation par LensDatabaseParser) : même système
      Hugin, R et B ré-échantillonnés séparément après la distorsion.
    - VIGNETTAGE (pa) : système différent, r=1 au COIN de l'image (demi-
      diagonale) — voir modifier.cpp. Correction multiplicative simple,
      pas de ré-échantillonnage.

    Échantillonnage par interpolation bilinéaire avec bords ÉCRÊTÉS (clamp),
    pas de bord transparent : plus cohérent visuellement pour une correction
    (pas une transformation créative) qu'un cadre qui disparaît.
=========================================================*/

class LensCorrectionFilter {

    process(imageData, settings) {
        if (!settings.lensCorrection) return imageData;

        const profile = settings.lensProfile;
        if (!profile) return imageData;

        const { distortion, tca, vignetting } = profile;
        if (!distortion && !tca && !vignetting) return imageData;

        const width = imageData.width;
        const height = imageData.height;
        const srcData = imageData.data;

        const centerX = (width - 1) / 2;
        const centerY = (height - 1) / 2;
        const huginScale = Math.min(width, height) / 2;
        const paScale = Math.sqrt(centerX * centerX + centerY * centerY) || 1;

        const needsResample = !!(distortion || tca);
        let outData;

        if (needsResample) {
            outData = new Uint8ClampedArray(srcData.length);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const dstIdx = (y * width + x) * 4;

                    const dx = (x - centerX) / huginScale;
                    const dy = (y - centerY) / huginScale;

                    // Vert = canal de référence : distorsion seule, pas de TCA.
                    const gPos = LensCorrectionFilter._applyDistortion(dx, dy, distortion);

                    // Rouge/Bleu : distorsion PUIS TCA, chaînées à partir de la
                    // MÊME position post-distorsion (voir ordre d'application).
                    const rPos = tca ? LensCorrectionFilter._applyTcaChannel(gPos, tca, "r") : gPos;
                    const bPos = tca ? LensCorrectionFilter._applyTcaChannel(gPos, tca, "b") : gPos;

                    const rPx = rPos.x * huginScale + centerX, rPy = rPos.y * huginScale + centerY;
                    const gPx = gPos.x * huginScale + centerX, gPy = gPos.y * huginScale + centerY;
                    const bPx = bPos.x * huginScale + centerX, bPy = bPos.y * huginScale + centerY;

                    outData[dstIdx]     = LensCorrectionFilter._bilinearChannel(srcData, width, height, rPx, rPy, 0);
                    outData[dstIdx + 1] = LensCorrectionFilter._bilinearChannel(srcData, width, height, gPx, gPy, 1);
                    outData[dstIdx + 2] = LensCorrectionFilter._bilinearChannel(srcData, width, height, bPx, bPy, 2);
                    outData[dstIdx + 3] = srcData[dstIdx + 3];
                }
            }
        } else {
            outData = new Uint8ClampedArray(srcData);
        }

        if (vignetting) {
            LensCorrectionFilter._applyVignetting(outData, width, height, centerX, centerY, paScale, vignetting);
        }

        return new ImageData(outData, width, height);
    }

    /**
     * Position (coordonnées Hugin normalisées) du pixel SOURCE correspondant
     * au pixel de destination (dx, dy) — Rd = Ru * facteur(Ru), voir
     * ModifyCoord_Dist_{Poly3,Poly5,PTLens} de mod-coord.cpp.
     */
    static _applyDistortion(dx, dy, distortion) {
        if (!distortion) return { x: dx, y: dy };

        const r2 = dx * dx + dy * dy;
        let factor;

        if (distortion.model === "ptlens") {
            const r = Math.sqrt(r2);
            factor = distortion.a * r2 * r + distortion.b * r2 + distortion.c * r + 1;
        } else if (distortion.model === "poly5") {
            factor = 1 + distortion.k1 * r2 + distortion.k2 * r2 * r2;
        } else { // poly3 (par défaut)
            factor = 1 + (distortion.k1 || 0) * r2;
        }

        return { x: dx * factor, y: dy * factor };
    }

    /**
     * Position (coordonnées Hugin) du pixel source pour UN canal (R ou B),
     * à partir de la position déjà corrigée de la distorsion — voir
     * ModifyCoord_TCA_Poly3 de mod-subpix.cpp : Rd = Ru * (b*Ru² + c*Ru + v).
     */
    static _applyTcaChannel(pos, tca, channel) {
        const r2 = pos.x * pos.x + pos.y * pos.y;
        const r = Math.sqrt(r2);
        const v = channel === "r" ? tca.vr : tca.vb;
        const c = channel === "r" ? tca.cr : tca.cb;
        const b = channel === "r" ? tca.br : tca.bb;
        const factor = b * r2 + c * r + v;
        return { x: pos.x * factor, y: pos.y * factor };
    }

    /** Interpolation bilinéaire d'UN SEUL canal, bords écrêtés (clamp, pas de transparence). */
    static _bilinearChannel(data, width, height, px, py, channelIndex) {
        const cx = Math.max(0, Math.min(width - 1.001, px));
        const cy = Math.max(0, Math.min(height - 1.001, py));

        const x0 = Math.floor(cx), y0 = Math.floor(cy);
        const x1 = x0 + 1, y1 = y0 + 1;
        const wx1 = cx - x0, wx0 = 1 - wx1;
        const wy1 = cy - y0, wy0 = 1 - wy1;

        const idx00 = (y0 * width + x0) * 4 + channelIndex;
        const idx10 = (y0 * width + x1) * 4 + channelIndex;
        const idx01 = (y1 * width + x0) * 4 + channelIndex;
        const idx11 = (y1 * width + x1) * 4 + channelIndex;

        return wy0 * (wx0 * data[idx00] + wx1 * data[idx10]) +
               wy1 * (wx0 * data[idx01] + wx1 * data[idx11]);
    }

    /**
     * Correction de vignettage (modèle "pa") : multiplicatif, pas de
     * ré-échantillonnage — voir ModifyColor_DeVignetting_PA de mod-color.cpp.
     * c = 1 + k1*r² + k2*r⁴ + k3*r⁶ (r=1 au coin de l'image) ; pixel /= c.
     */
    static _applyVignetting(data, width, height, centerX, centerY, paScale, vignetting) {
        const k1 = vignetting.k1 || 0, k2 = vignetting.k2 || 0, k3 = vignetting.k3 || 0;

        for (let y = 0; y < height; y++) {
            const dy = (y - centerY) / paScale;
            for (let x = 0; x < width; x++) {
                const dx = (x - centerX) / paScale;
                const r2 = dx * dx + dy * dy;
                const r4 = r2 * r2;
                const r6 = r4 * r2;

                let c = 1 + k1 * r2 + k2 * r4 + k3 * r6;
                if (c < 0.1) c = 0.1; // évite une division explosive en bord de champ extrême

                const idx = (y * width + x) * 4;
                data[idx]     = Math.max(0, Math.min(255, data[idx] / c));
                data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] / c));
                data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] / c));
            }
        }
    }
}

if (typeof window !== "undefined") {
    window.LensCorrectionFilter = LensCorrectionFilter;
}
