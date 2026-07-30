const path = require('path');
const fs = require('fs');
const exifr = require('exifr');

const SUPPORTED_EXTENSIONS = ['.nef', '.cr2', '.cr3', '.raf', '.arw', '.rw2', '.dng', '.pef', '.orf'];

/**
 * Extrait la grande prévisualisation JPEG intégrée dans le RAW
 */
async function decodeRAWImage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        throw new Error(`Extension non prise en charge : ${ext}`);
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`Fichier introuvable : ${filePath}`);
    }

    const fileBuffer = await fs.promises.readFile(filePath);

    // --- ESSAI 1 : Extraire l'image grand format via exifr.parse ---
    try {
        // Extraction de toutes les balises TIFF/Exif/Preview sans réduire à la miniature 160x120
        const extracted = await exifr.parse(fileBuffer, {
            tiff: true,
            exif: true,
            xmp: true,
            preview: true,
            thumbnail: false // On désactive explicitement la vignette 160x120
        });

        // Recherche du buffer JPEG principal (PreviewImage ou JpegIFD)
        let mainJpeg = extracted?.PreviewImage || extracted?.JpgFromRaw || extracted?.JPEGInterchangeFormat;

        if (mainJpeg && mainJpeg.length > 100000) { // On filtre sur une taille > 100 Ko pour éviter les vignettes
            console.log(`✅ RAW (${ext}) grande prévisualisation extraite via EXIF/TIFF (${(mainJpeg.length / 1024).toFixed(1)} Ko)`);
            return `data:image/jpeg;base64,${Buffer.from(mainJpeg).toString('base64')}`;
        }
    } catch (errParse) {
        console.warn(`⚠️ Erreur lecture balise PreviewImage :`, errParse.message);
    }

    // --- ESSAI 2 : Scan binaire des blocs JPEG (Cherche la plus grande image intégrée) ---
    try {
        // Un fichier RAW contient plusieurs JPEG (vignette + grande preview). 
        // On isole tous les segments 0xFFD8FF ... 0xFFD9 et on garde le plus gros buffer.
        let largestJpeg = null;
        let maxSize = 0;

        let pos = 0;
        const soiMarker = Buffer.from([0xFF, 0xD8, 0xFF]);
        const eoiMarker = Buffer.from([0xFF, 0xD9]);

        while (pos < fileBuffer.length) {
            const soi = fileBuffer.indexOf(soiMarker, pos);
            if (soi === -1) break;

            const eoi = fileBuffer.indexOf(eoiMarker, soi + 3);
            if (eoi === -1) break;

            const length = (eoi + 2) - soi;
            // Si l'image fait plus de 200 Ko, c'est la vraie photo HD et non la miniature
            if (length > 200000 && length > maxSize) {
                maxSize = length;
                largestJpeg = fileBuffer.subarray(soi, eoi + 2);
            }

            pos = eoi + 2;
        }

        if (largestJpeg) {
            console.log(`✅ RAW (${ext}) extrait via scan binaire HD (${(maxSize / 1024).toFixed(1)} Ko)`);
            return `data:image/jpeg;base64,${largestJpeg.toString('base64')}`;
        }
    } catch (errScan) {
        console.error(`❌ Échec du scan binaire HD :`, errScan.message);
    }

    throw new Error(`Impossible de trouver une prévisualisation HD dans ${path.basename(filePath)}`);
}

module.exports = {
    decodeRAWImage,
    SUPPORTED_EXTENSIONS
};