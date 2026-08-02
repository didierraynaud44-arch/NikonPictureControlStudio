class ExposureFilter {
    constructor() {
        this.name = "Exposure";
    }

    apply(imageData, pc) {
        if (!imageData || !pc) return imageData;

        const raw = pc.exposure ?? 0;
        const exposure = typeof raw === "number" ? raw : parseFloat(raw) || 0;

        if (exposure === 0) return imageData;

        // Gain multiplicatif en stops (EV) : chaque +1 double la luminosité, chaque -1 la divise par 2
        const gain = Math.pow(2, exposure);

        const data = imageData.data;
        const len = data.length;

        for (let i = 0; i < len; i += 4) {
            data[i]     = Math.min(255, Math.max(0, data[i]     * gain));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * gain));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * gain));
        }

        return imageData;
    }
}

window.ExposureFilter = ExposureFilter;
