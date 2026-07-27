class SaturationFilter extends BaseFilter {

    apply(imageData, pictureControl) {

        if (!pictureControl || pictureControl.saturation === undefined)
            return imageData;

        const saturation = Number(pictureControl.saturation);

        // Si la valeur est neutre (vérifie si ta valeur par défaut est 0)
        if (this.isNeutral ? this.isNeutral(saturation) : saturation === 0)
            return imageData;

        // Échelle progressive : ajuster le diviseur (ici 3.0) selon l'amplitude réelle de ton NP3
        const factor = 1 + (saturation / 3.0);

        const data = imageData.data;
        const len = data.length;

        for (let i = 0; i < len; i += 4) {

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // 1. Luminance Rec.709 (Perception visuelle moderne)
            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            // 2. Calcul des nouvelles valeurs
            let newR = gray + (r - gray) * factor;
            let newG = gray + (g - gray) * factor;
            let newB = gray + (b - gray) * factor;

            // 3. Protection contre le décalage de teinte en cas de dépassement (Gamut Clipping)
            const maxVal = Math.max(newR, newG, newB);
            if (maxVal > 255) {
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