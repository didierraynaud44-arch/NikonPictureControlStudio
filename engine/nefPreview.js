const { execFile } = require("child_process");
const path = require("path");
const { app } = require("electron");

// 1. Détection dynamique du chemin absolu d'ExifTool
const isPackaged = app ? app.isPackaged : process.mainModule.filename.includes("app.asar");

const exiftool = isPackaged
    ? path.join(process.resourcesPath, "bin", "exiftool.exe")
    : path.join(__dirname, "../bin/exiftool.exe"); // Pointe vers ton dossier bin/ local

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
                maxBuffer: 15 * 1024 * 1024,
                // On s'assure que le process travaille dans le répertoire exact de l'exe 
                // pour qu'il trouve exiftool_files/ juste à côté de lui !
                cwd: path.dirname(exiftool)
            },
            (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }

                const base64 = stdout.toString("base64");

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