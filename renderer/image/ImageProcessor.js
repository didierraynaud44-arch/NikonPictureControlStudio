class ImageProcessor {

    constructor() {

        this.canvas = document.getElementById("previewCanvas");
        this.ctx = this.canvas.getContext("2d");

        this.originalImage = null;

    }

    async load(src) {

        return new Promise((resolve) => {

            const img = new Image();

            img.onload = () => {

                this.originalImage = img;
const maxWidth = this.canvas.parentElement.clientWidth - 20;
const maxHeight = this.canvas.parentElement.clientHeight - 20;

const ratio = Math.min(
    maxWidth / img.width,
    maxHeight / img.height
);

const w = Math.round(img.width * ratio);
const h = Math.round(img.height * ratio);

this.canvas.width = w;
this.canvas.height = h;

this.ctx.clearRect(0, 0, w, h);
this.ctx.drawImage(img, 0, 0, w, h);

                resolve();

            };

            img.src = src;

        });

    }

    render() {

        if (!this.originalImage)
            return;

        this.ctx.drawImage(this.originalImage, 0, 0);

    }

}

window.imageProcessor = new ImageProcessor();