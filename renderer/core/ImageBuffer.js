class ImageBuffer {

    constructor() {

        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }

    async load(src) {

        return new Promise((resolve, reject) => {

            const img = new Image();

            img.onload = () => {

                this.canvas.width = img.width;
                this.canvas.height = img.height;

                this.ctx.drawImage(img, 0, 0);

                resolve();

            };

            img.onerror = reject;

            img.src = src;

        });

    }

    getWidth() {

        return this.canvas.width;

    }

    getHeight() {

        return this.canvas.height;

    }

    getImageData() {

        return this.ctx.getImageData(

            0,
            0,

            this.canvas.width,
            this.canvas.height

        );

    }

}
window.ImageBuffer = ImageBuffer;