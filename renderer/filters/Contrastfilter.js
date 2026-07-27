class ContrastFilter extends BaseFilter {

    apply(imageData, pictureControl) {
        if (!pictureControl)
            return imageData;

        const contrast = Number(pictureControl.contrast);

        if (this.isNeutral(contrast))
            return imageData;

        // Normalisation douce : amplitude maximale restreinte pour éviter l'effet "brûlé"
        // contrast va de -3 à +3 -> val varie entre -0.30 et +0.30
        const val = (contrast / 3.0) * 0.30;

        const data = imageData.data;
        const len = data.length;

        // Pré-calcul d'une courbe de contraste fluide (LUT)
        const lut = new Uint8Array(256);
        const factor = (1 + val) / (1 - val);

        for (let i = 0; i < 256; i++) {
            // Pivot sur le gris moyen visuel
            let result = factor * (i - 128) + 128;
            lut[i] = this.clamp(result);
        }

        // Application sur l'image
        for (let i = 0; i < len; i += 4) {
            data[i]     = lut[data[i]];     // R
            data[i + 1] = lut[data[i + 1]]; // G
            data[i + 2] = lut[data[i + 2]]; // B
        }

        return imageData;
    }
}

window.ContrastFilter = ContrastFilter;