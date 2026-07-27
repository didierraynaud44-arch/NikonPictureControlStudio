class SaturationFilter {

    apply(imageData, pictureControl) {

        if (!pictureControl)
            return imageData;

        const saturation = pictureControl.saturation;

        if (saturation === 0)
            return imageData;

        const factor = 1 + (saturation * 0.20);

        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const gray = 0.299 * r + 0.587 * g + 0.114 * b;

           data[i] = Math.max(0, Math.min(255, gray + (r - gray) * factor));

data[i + 1] = Math.max(0, Math.min(255, gray + (g - gray) * factor));

data[i + 2] = Math.max(0, Math.min(255, gray + (b - gray) * factor));
        }

        return imageData;

    }

}


window.SaturationFilter = SaturationFilter;