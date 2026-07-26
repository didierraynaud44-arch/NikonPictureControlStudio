class ContrastFilter {

    apply(imageData, pictureControl) {

        if (!pictureControl)
            return imageData;

        const value = pictureControl.contrast * 30;

        if (value === 0)
            return imageData;

        const data = imageData.data;

        const factor =
            (259 * (value + 255)) /
            (255 * (259 - value));

        for (let i = 0; i < data.length; i += 4) {

            data[i] = clamp(factor * (data[i] - 128) + 128);
            data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128);
            data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128);

        }

        return imageData;

    }

}

function clamp(v) {

    return Math.max(0, Math.min(255, v));

}

window.ContrastFilter = ContrastFilter;