class ImageProcessor {

    constructor(canvasId) {

        this.buffer = new ImageBuffer();
        this.display = new DisplayCanvas(canvasId);

        this.pictureControl = null;

    }

    async load(src) {

        await this.buffer.load(src);

        this.display.resize(

            this.buffer.getWidth(),
            this.buffer.getHeight()

        );

        this.render();

    }

    setPictureControl(pc) {

        this.pictureControl = pc;

        this.render();

    }


render() {

    console.log("Render appelé");

    let imageData = this.buffer.getImageData();

    if (this.pictureControl) {

        console.log("Contraste :", this.pictureControl.contrast);

        imageData = ContrastFilter.apply(
            imageData,
            this.pictureControl.contrast * 30
        );

    }

    this.display.draw(imageData);

}
}

window.imageProcessor = new ImageProcessor("previewCanvas");