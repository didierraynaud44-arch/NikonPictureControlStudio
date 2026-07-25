class ContrastFilter {

    static apply(imageData, value) {

        if (value === 0)
            return imageData;

        const data = imageData.data;

        // facteur de contraste
        const factor = (259 * (value + 255)) / (255 * (259 - value));

        for (let i = 0; i < data.length; i += 4) {

            data[i]     = clamp(factor * (data[i]     - 128) + 128);
            data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128);
            data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128);

        }

        return imageData;

    }

}

function clamp(v) {

    if (v < 0) return 0;

    if (v > 255) return 255;

    return v;

}

window.ContrastFilter = ContrastFilter;