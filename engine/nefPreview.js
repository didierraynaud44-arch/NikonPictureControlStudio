const { execFile } = require("child_process");
const path = require("path");


const exiftool = path.join(
    __dirname,
    "../tools/exiftool.exe"
);


function getPreview(filePath) {

    return new Promise((resolve, reject) => {


        execFile(
            exiftool,

            [
                "-JpgFromRaw",
                "-b",
                filePath
            ],

            {
                encoding: "buffer",
                maxBuffer: 10 * 1024 * 1024
            },

            (error, stdout) => {


                if (error) {

                    reject(error);
                    return;

                }


                const base64 =
                    stdout.toString("base64");


                resolve(
                    "data:image/jpeg;base64," + base64
                );


            }
        );


    });

}


module.exports = {
    getPreview
};