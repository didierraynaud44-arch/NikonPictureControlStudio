/*=========================================================
    Nikon Picture Control Studio - Catalogue : scan de dossier
=========================================================*/

const { exiftool } = require("exiftool-vendored");
const path = require("path");
const fs = require("fs");
const { dbRun } = require("./db");

function getAllFiles(dirPath, arrayOfFiles = []) {
    try {
        const files = fs.readdirSync(dirPath);
        files.forEach(file => {
            const fullPath = path.join(dirPath, file);
            try {
                if (fs.statSync(fullPath).isDirectory()) {
                    arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
                } else {
                    const ext = path.extname(file).toLowerCase();
                    if (ext === ".nef" || ext === ".jpg" || ext === ".jpeg") {
                        arrayOfFiles.push(fullPath);
                    }
                }
            } catch (e) { /* fichier/dossier illisible, on ignore */ }
        });
    } catch (e) { /* dossier illisible, on ignore */ }
    return arrayOfFiles;
}

async function extractThumbnail(filePath, thumbPath) {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".nef") {
        try {
            await exiftool.extractBinaryTag("JpgFromRaw", filePath, thumbPath);
        } catch (e) {
            try {
                await exiftool.extractBinaryTag("PreviewImage", filePath, thumbPath);
            } catch (err) { /* pas de vignette embarquée exploitable */ }
        }
    } else {
        fs.copyFileSync(filePath, thumbPath);
    }
}

/**
 * Scanne un dossier (récursivement), indexe chaque photo trouvée en base
 * et extrait ses vignettes.
 * @param {string} folderPath - dossier à scanner
 * @param {string} cacheDir - dossier ABSOLU où stocker les vignettes
 *        (fourni par main.js, typiquement dans app.getPath('userData'))
 * @param {function} onProgress - callback(current, total, filename)
 */
async function scanFolder(folderPath, cacheDir, onProgress = () => {}) {
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    const folderName = path.basename(folderPath);
    await dbRun(`INSERT OR IGNORE INTO folders (folder_path, folder_name) VALUES (?, ?)`, [folderPath, folderName]);

    const photoFiles = getAllFiles(folderPath);
    let indexedCount = 0;

    for (const filePath of photoFiles) {
        const fileName = path.basename(filePath);
        const thumbPath = path.join(cacheDir, `${path.parse(fileName).name}_thumb.jpg`);

        try {
            if (!fs.existsSync(thumbPath) || fs.statSync(thumbPath).size === 0) {
                await extractThumbnail(filePath, thumbPath);
            }

            const tags = await exiftool.read(filePath);

            const fileSize = tags.FileSize || 0;
            const dateTaken = tags.DateTimeOriginal ? tags.DateTimeOriginal.toString() : null;
            const cameraModel = tags.Model || "Inconnu";
            const lens = tags.LensID || tags.Lens || "Inconnue";
            const iso = tags.ISO || null;
            const aperture = tags.FNumber || null;
            const shutterSpeed = tags.ExposureTime ? tags.ExposureTime.toString() : null;
            const pictureControl = tags.PictureControlName || tags.PictureControlData || "Standard";

            await dbRun(`
                INSERT OR REPLACE INTO photos
                (file_path, file_name, file_size, date_taken, camera_model, lens, iso, aperture, shutter_speed, picture_control, folder_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [filePath, fileName, fileSize, dateTaken, cameraModel, lens, iso, aperture, shutterSpeed, pictureControl, folderPath]);

            indexedCount++;
            onProgress(indexedCount, photoFiles.length, fileName);

        } catch (err) {
            console.error(`❌ [catalogue] Erreur sur ${fileName} :`, err.message);
        }
    }

    return indexedCount;
}

module.exports = { scanFolder, getAllFiles };
