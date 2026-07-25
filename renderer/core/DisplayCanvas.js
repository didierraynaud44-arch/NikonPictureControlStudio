class DisplayCanvas {

    constructor(canvasId) {

        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");

    }

    resize(width, height) {

        this.canvas.width = width;
        this.canvas.height = height;

    }

    draw(imageData) {

        this.ctx.putImageData(imageData, 0, 0);

    }

}

window.DisplayCanvas = DisplayCanvas;