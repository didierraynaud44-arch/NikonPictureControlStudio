class RenderPipeline {

    constructor() {

        this.filters = [];

    }

    add(filter) {

        this.filters.push(filter);

    }

    process(imageData, pictureControl) {

        let result = imageData;

        for (const filter of this.filters) {

            result = filter.apply(result, pictureControl);

        }

        return result;

    }

}

window.RenderPipeline = RenderPipeline;