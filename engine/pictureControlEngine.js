const ToneCurve = require("./ToneCurve");

class PictureControlEngine {

    static build(pictureControl) {

        return {

            toneCurve: ToneCurve.build(pictureControl),

            contrast: pictureControl.contrast,

            highlights: pictureControl.highlights,

            shadows: pictureControl.shadows,

            saturation: pictureControl.saturation,

            clarity: pictureControl.clarity,

            sharpen: pictureControl.sharpness,

            midRangeSharpen: pictureControl.midRangeSharpen,

            colorBlender: pictureControl.colorBlender,

            colorGrading: pictureControl.colorGrading

        };

    }

}

module.exports = PictureControlEngine;