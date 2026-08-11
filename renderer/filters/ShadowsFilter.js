class ShadowsFilter extends BaseFilter {

    apply(imageData, pictureControl) {

        if (!pictureControl)
            return imageData;

        const shadows = Number(pictureControl.shadows);

        if (this.isNeutral(shadows))
            return imageData;

        // Normalisation (ajuste selon l'amplitude max de ton NP3, ex: -3.0 à +3.0)
        const amount = shadows / 5.0;

        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // 1. Luminance moderne Rec.709
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            // 2. Masque progressif des ombres (Inversé : max d'effet à 0, s'éteint vers 128)
            // normLum va de 0.0 (noir) à 1.0 (gris moyen à 128)
            if (lum < 128) {
                const normLum = lum / 128;
                
                // Poids régressif doux (agissant plus fort sur les vraies ombres)
                const shadowWeight = (1 - normLum) * (1 - normLum); 

                // 3. Calcul du décalage
                // Si amount > 0 (débouchage des ombres) -> augmentation proportionnelle
                // Si amount < 0 (assombrissement des ombres) -> compression vers le noir
                const delta = (amount > 0)
                    ? amount * 35 * shadowWeight * (1 - normLum * 0.5)
                    : amount * 25 * shadowWeight;

                data[i]     = this.clamp(r + delta);
                data[i + 1] = this.clamp(g + delta);
                data[i + 2] = this.clamp(b + delta);
            }
        }

        return imageData;

    }

}

window.ShadowsFilter = ShadowsFilter;