class SharpenFilter extends BaseFilter {

    apply(imageData, pictureControl) {
        if (!pictureControl) return imageData;

        const sharp = Number(pictureControl.sharpning ?? pictureControl.sharpening);
        if (this.isNeutral(sharp)) return imageData;

        const width = imageData.width;
        const height = imageData.height;
        const src = imageData.data;

        const output = this.clone(imageData);
        const dst = output.data;

        const amount = sharp / 9.0;
        if (amount === 0) return imageData;

        // Seuil pour ignorer le bruit de fond et éviter de blanchir les aplats
        const threshold = 3.0;

        const step = Math.max(1, Math.round(width / 1600));

        for (let y = step; y < height - step; y++) {
            for (let x = step; x < width - step; x++) {

                const i = (y * width + x) * 4;

                const r = src[i];
                const g = src[i + 1];
                const b = src[i + 2];

                // Luminance de précision (Rec. 709)
                const yCenter = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                // Voisins
                const top    = ((y - step) * width + x) * 4;
                const bottom = ((y + step) * width + x) * 4;
                const left   = (y * width + (x - step)) * 4;
                const right  = (y * width + (x + step)) * 4;

                const yAvg = (
                    (0.2126 * src[top]    + 0.7152 * src[top + 1]    + 0.0722 * src[top + 2]) +
                    (0.2126 * src[bottom] + 0.7152 * src[bottom + 1] + 0.0722 * src[bottom + 2]) +
                    (0.2126 * src[left]   + 0.7152 * src[left + 1]   + 0.0722 * src[left + 2]) +
                    (0.2126 * src[right]  + 0.7152 * src[right + 1]  + 0.0722 * src[right + 2])
                ) * 0.25;

                const diff = yCenter - yAvg;

                // On n'accentue QUE si la différence dépasse le seuil (préserve les aplats et les noirs)
                if (Math.abs(diff) > threshold) {
                    const factor = amount * 0.8;
                    dst[i]     = this.clamp(r + diff * factor);
                    dst[i + 1] = this.clamp(g + diff * factor);
                    dst[i + 2] = this.clamp(b + diff * factor);
                }
            }
        }

        return output;
    }
}

window.SharpenFilter = SharpenFilter;