/*=========================================================
    Nikon Picture Control Studio - Saturation Filter
=========================================================*/

class SaturationFilter extends BaseFilter {

    apply(imageData, pictureControl) {

        if (!pictureControl || pictureControl.saturation === undefined)
            return imageData;

        if (pictureControl.isMonochrome) return imageData;

        let saturation = Number(pictureControl.saturation);
        if (isNaN(saturation)) saturation = 0;

        // Si la valeur est neutre (0)
        if (saturation === 0)
            return imageData;

        // --- Normalisation de l'échelle Nikon ---
        // Si l'échelle lue est entre -100 et +100, on la ramène entre -3 et +3
        if (Math.abs(saturation) > 10) {
            saturation = (saturation / 100) * 3;
        }

        // Calcul du facteur (0.2 à 2.0 au lieu de tomber à 0)
        // -3 donne factor = 0.2 (désaturé mais conserve la couleur)
        // +3 donne factor = 1.8 (couleurs vives)
        const factor = Math.max(0, 1 + (saturation / 3.75));

        const data = imageData.data;
        const len = data.length;

        for (let i = 0; i < len; i += 4) {

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // 1. Luminance Rec.709
            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            // 2. Application de la saturation
            let newR = gray + (r - gray) * factor;
            let newG = gray + (g - gray) * factor;
            let newB = gray + (b - gray) * factor;

            // 3. Gamut Clipping (protection saturation extrême)
            const maxVal = Math.max(newR, newG, newB);
            if (maxVal > 255 && maxVal > gray) {
                const scale = (255 - gray) / (maxVal - gray);
                newR = gray + (newR - gray) * scale;
                newG = gray + (newG - gray) * scale;
                newB = gray + (newB - gray) * scale;
            }

            data[i]     = Math.max(0, Math.min(255, newR));
            data[i + 1] = Math.max(0, Math.min(255, newG));
            data[i + 2] = Math.max(0, Math.min(255, newB));
        }

        return imageData;
    }

}

window.SaturationFilter = SaturationFilter;