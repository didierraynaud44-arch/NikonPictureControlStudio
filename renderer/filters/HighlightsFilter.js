class HighlightsFilter {

    apply(imageData, pictureControl) {

        if (!pictureControl)
            return imageData;

        const value = pictureControl.highlights;

        if (value === 0)
            return imageData;

        const data = imageData.data;

        const strength = value * 8;

        for (let i = 0; i < data.length; i += 4) {

            const luminance =
                0.299 * data[i] +
                0.587 * data[i + 1] +
                0.114 * data[i + 2];

            if (luminance > 170) {

                const weight = (luminance - 170) / 85;

                data[i] = clamp(data[i] + strength * weight);
                data[i + 1] = clamp(data[i + 1] + strength * weight);
                data[i + 2] = clamp(data[i + 2] + strength * weight);

            }

        }

        return imageData;

    }

}

function clamp(v) {

    return Math.max(0, Math.min(255, v));

}

window.HighlightsFilter = HighlightsFilter;