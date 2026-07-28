const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

// 1. Détection dynamique du chemin d'ExifTool (identique à nefPreview.js)
const isPackaged = app ? app.isPackaged : process.mainModule?.filename.includes("app.asar");

const exiftool = isPackaged
    ? path.join(process.resourcesPath, "bin", "exiftool.exe")
    : path.join(__dirname, "../bin/exiftool.exe");

/**
 * Lit l'intégralité des EXIFs d'un fichier NEF via ExifTool
 */
function readNEF(filePath) {
    return new Promise((resolve) => {
        // Normalisation du chemin du fichier (antislashs Windows)
        const safePath = path.resolve(filePath).replace(/\\/g, "/");

        const args = ["-json", "-n", safePath];

        execFile(
            exiftool,
            args,
            {
                cwd: path.dirname(exiftool), // Crucial pour les DLLs / exiftool_files
                windowsHide: true,
                maxBuffer: 25 * 1024 * 1024
            },
            (error, stdout, stderr) => {
                if (error) {
                    console.error("❌ Erreur ExifTool dans nefReader :", error.message);
                    return resolve(getFallbackData(filePath));
                }

                try {
                    const dataArray = JSON.parse(stdout);
                    const data = dataArray && dataArray[0] ? dataArray[0] : null;

                    if (!data) {
                        return resolve(getFallbackData(filePath));
                    }

                    // --- Formateurs de valeurs ---

                    // Vitesse
                    let shutterStr = "N/C";
                    if (data.ExposureTime) {
                        const sec = Number(data.ExposureTime);
                        shutterStr = sec < 1 ? `1/${Math.round(1 / sec)}s` : `${sec}s`;
                    }

                    // Correction Expo
                    let expCompStr = "0 EV";
                    const expBias = data.ExposureCompensation !== undefined ? data.ExposureCompensation : data.ExposureBiasValue;
                    if (expBias !== undefined && expBias !== null) {
                        const val = Number(expBias);
                        expCompStr = val === 0 ? "0 EV" : (val > 0 ? `+${val.toFixed(1)} EV` : `${val.toFixed(1)} EV`);
                    }

                    // Date
                    let dateStr = "";
                    if (data.DateTimeOriginal) {
                        const parts = String(data.DateTimeOriginal).split(" ");
                        if (parts.length === 2) {
                            const dateParts = parts[0].replace(/:/g, "-");
                            dateStr = new Date(`${dateParts}T${parts[1]}`).toLocaleString("fr-FR");
                        }
                    }

                    // Programme d'exposition
                    const programs = {
                        0: "Non défini", 1: "Manuel", 2: "Programme (P)",
                        3: "Priorité Ouverture (A)", 4: "Priorité Vitesse (S)",
                        5: "Créatif", 6: "Action", 7: "Portrait", 8: "Paysage"
                    };

                    resolve({
                        path: filePath,
                        fileName: path.basename(filePath),

                        make: data.Make || "Nikon",
                        model: data.Model || "Boîtier Nikon",
                        lens: data.LensModel || data.Lens || data.LensID || "Non renseigné",
                        artist: data.Artist || data["By-line"] || data.Copyright || "Non renseigné",
                        comment: data.UserComment || data.Description || "Aucun",

                        // 📸 Compteur de déclenchements Nikon
                        shutterCount: data.ShutterCount !== undefined ? Number(data.ShutterCount) : "N/C",

                        // ⚙️ Réglages
                        iso: data.ISO ? data.ISO : "N/C",
                        aperture: data.FNumber ? `f/${data.FNumber}` : "N/C",
                        shutter: shutterStr,
                        focal: data.FocalLength ? `${data.FocalLength}mm` : "N/C",

                        exposureProgram: programs[data.ExposureProgram] || "Inconnu",
                        exposureCompensation: expCompStr,
                        meteringMode: data.MeteringMode || "Matricielle",
                        flash: data.Flash === 0 ? "Non déclenché" : "Déclenché",
                        date: dateStr
                    });

                } catch (parseErr) {
                    console.error("❌ Erreur parsing JSON ExifTool :", parseErr);
                    resolve(getFallbackData(filePath));
                }
            }
        );
    });
}

function getFallbackData(filePath) {
    return {
        path: filePath,
        fileName: path.basename(filePath),
        make: "Inconnu",
        model: "Inconnu",
        lens: "Inconnu",
        artist: "Non renseigné",
        comment: "Aucun",
        shutterCount: "N/C",
        iso: "N/C",
        aperture: "N/C",
        shutter: "N/C",
        focal: "N/C",
        exposureProgram: "Inconnu",
        exposureCompensation: "0 EV",
        meteringMode: "Inconnu",
        flash: "Inconnu",
        date: ""
    };
}

module.exports = { readNEF };