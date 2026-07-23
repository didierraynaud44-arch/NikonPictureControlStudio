const { execFile } = require("child_process");
const path = require("path");


function readPictureControl(filePath) {

    return new Promise((resolve, reject) => {


        const exiftool = path.join(
            __dirname,
            "..",
            "tools",
            "exiftool.exe"
        );


        const args = [
            "-PictureControlName",
            "-Sharpness",
            "-Contrast",
            "-Brightness",
            "-Saturation",
            "-Hue",
            "-json",
            filePath
        ];


        execFile(exiftool, args, (error, stdout) => {


            if (error) {

                reject(error);
                return;

            }


            try {

                const data = JSON.parse(stdout)[0];


                resolve({

                    name: data.PictureControlName || "",
                    sharpness: data.Sharpness || "",
                    contrast: data.Contrast || "",
                    brightness: data.Brightness || "",
                    saturation: data.Saturation || "",
                    hue: data.Hue || ""

                });


            }
            catch(e) {

                reject(e);

            }

        });

    });

}


module.exports = {
    readPictureControl
};