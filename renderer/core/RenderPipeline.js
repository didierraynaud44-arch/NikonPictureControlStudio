class RenderPipeline {

    constructor() {
        this.filters = [];
    }

    add(filter) {
        this.filters.push(filter);
    }

    process(imageData, pictureControl) {
        if (!imageData) return null;

        // 1. On crée une COPIE NEUVE des pixels originaux pour ne jamais polluer l'image source
        const clonedPixels = new Uint8ClampedArray(imageData.data);
        let result = new ImageData(clonedPixels, imageData.width, imageData.height);

        // 2. On fait passer la copie dans chaque filtre
        for (const filter of this.filters) {
            result = filter.apply(result, pictureControl);
        }

        return result;
    }

}

window.RenderPipeline = RenderPipeline;