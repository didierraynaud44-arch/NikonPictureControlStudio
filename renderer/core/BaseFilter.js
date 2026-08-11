class BaseFilter {

    clone(imageData) {

        return new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );

    }

    clamp(value) {

        return Math.max(0, Math.min(255, value));

    }

    isNeutral(value) {

        return !Number.isFinite(value) || value === 0;

    }

}

window.BaseFilter = BaseFilter;