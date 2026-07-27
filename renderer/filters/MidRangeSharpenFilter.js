class MidRangeSharpenFilter extends BaseFilter {

    apply(imageData, pictureControl) {
        if (!pictureControl) return imageData;

        const midSharp = Number(pictureControl.midRangeSharpning ?? pictureControl.midRangeSharpening);
        if (this.isNeutral(midSharp)) return imageData;

        const width = imageData.width;
        const height = imageData.height;
        const src = imageData.data;

        const output = this.clone(imageData);
        const dst = output.data;

        const amount = midSharp / 5.0;
        if (amount === 0) return imageData;

        const threshold = 2.0;

        for (let y = 2; y < height - 2; y++) {
            for (let x = 2; x < width - 2; x++) {

                const i = (y * width + x) * 4;

                const r = src[i];
                const g = src[i + 1];
                const b = src[i + 2];

                const yCenter = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                const top    = ((y - 2) * width + x) * 4;
                const bottom = ((y + 2) * width + x) * 4;
                const left   = (y * width + (x - 2)) * 4;
                const right  = (y * width + (x + 2)) * 4;

                const yAvg = (
                    (0.2126 * src[top]    + 0.7152 * src[top + 1]    + 0.0722 * src[top + 2]) +
                    (0.2126 * src[bottom] + 0.7152 * src[bottom + 1] + 0.0722 * src[bottom + 2]) +
                    (0.2126 * src[left]   + 0.7152 * src[left + 1]   + 0.0722 * src[left + 2]) +
                    (0.2126 * src[right]  + 0.7152 * src[right + 1]  + 0.0722 * src[right + 2])
                ) * 0.25;

                const diff = yCenter - yAvg;

                if (Math.abs(diff) > threshold) {
                    const factor = amount * 0.6;
                    dst[i]     = this.clamp(r + diff * factor);
                    dst[i + 1] = this.clamp(g + diff * factor);
                    dst[i + 2] = this.clamp(b + diff * factor);
                }
            }
        }

        return output;
    }
}

window.MidRangeSharpenFilter = MidRangeSharpenFilter;