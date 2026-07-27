const { execFile } = require("child_process");
const path = require("path");
const { app } = require("electron");

// 1. Détection dynamique du chemin absolu vers bin/exiftool.exe
const isPackaged = app ? app.isPackaged : process.mainModule.filename.includes("app.asar");

const exiftool = isPackaged
    ? path.join(process.resourcesPath, "bin", "exiftool.exe")
    : path.join(__dirname, "..", "bin", "exiftool.exe");

function readPictureControl(filePath) {
    return new Promise((resolve, reject) => {
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

        execFile(
            exiftool,
            args,
            {
                encoding: "utf-8",
                // Option clé : force l'exécution dans bin/ pour trouver les DLLs Perl
                cwd: path.dirname(exiftool)
            },
            (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }

                try {
                    const data = JSON.parse(stdout)[0] || {};

                    resolve({
                        name: data.PictureControlName || "",
                        sharpness: data.Sharpness || "",
                        contrast: data.Contrast || "",
                        brightness: data.Brightness || "",
                        saturation: data.Saturation || "",
                        hue: data.Hue || ""
                    });
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

module.exports = {
    readPictureControl
};