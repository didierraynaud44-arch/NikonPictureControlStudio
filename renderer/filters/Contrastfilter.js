class ContrastFilter extends BaseFilter {

    apply(imageData, pictureControl) {

        if (!pictureControl)
            return imageData;

        const contrast = Number(pictureControl.contrast);

        if (this.isNeutral(contrast))
            return imageData;

        const value = contrast * 30;

        const factor =
            (259 * (value + 255)) /
            (255 * (259 - value));

        const output = this.clone(imageData);

        const data = output.data;

        for (let i = 0; i < data.length; i += 4) {

            data[i] = this.clamp(
                factor * (data[i] - 128) + 128
            );

            data[i + 1] = this.clamp(
                factor * (data[i + 1] - 128) + 128
            );

            data[i + 2] = this.clamp(
                factor * (data[i + 2] - 128) + 128
            );

        }

        return output;

    }

}

window.ContrastFilter = ContrastFilter;