class ImageProcessor {

    constructor(canvasId) {

        this.buffer = new ImageBuffer();
        this.display = new DisplayCanvas(canvasId);

        this.pictureControl = null;

        this.pipeline = new RenderPipeline();

        // Liste des filtres

this.pipeline.add(new ContrastFilter());
this.pipeline.add(new HighlightsFilter());
this.pipeline.add(new ShadowsFilter());
this.pipeline.add(new SaturationFilter());
this.pipeline.add(new ClarityFilter());
this.pipeline.add(new SharpenFilter());
this.pipeline.add(new MidRangeSharpenFilter());
this.pipeline.add(new ToneCurveFilter());
this.pipeline.add(new ColorBlenderFilter());
this.pipeline.add(new ColorGradingFilter());
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

        if (this.buffer.getWidth() === 0)
            return;

        let imageData = this.buffer.getImageData();

        imageData = this.pipeline.process(

            imageData,
            this.pictureControl

        );

        this.display.draw(imageData);

    }

}

window.imageProcessor = new ImageProcessor("previewCanvas");