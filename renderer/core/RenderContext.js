class RenderContext {

    constructor(imageData, pictureControl) {

        this.original = imageData;

        this.working = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );

        this.pictureControl = pictureControl;

    }

}

window.RenderContext = RenderContext;