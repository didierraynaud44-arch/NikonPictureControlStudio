const path = require('path');
const fs = require('fs');
const exifr = require('exifr');
const sharp = require('sharp');

const SUPPORTED_EXTENSIONS = ['.nef', '.cr2', '.cr3', '.raf', '.arw', '.rw2', '.dng', '.pef', '.orf'];

/**
 * Reconstruit et convertit un buffer JPEG en Data URL propre pour le Canvas Electron
 */
async function toStandardJpegDataUrl(buffer) {
    const cleanBuffer = await sharp(buffer)
        .rotate() // Applique l'orientation EXIF automatique
        .jpeg({ quality: 90 })
        .toBuffer();

    return `data:image/jpeg;base64,${cleanBuffer.toString('base64')}`;
}

/**
 * Extrait la grande prévisualisation JPEG intégrée dans le RAW multi-marques
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

    // --- ESSAI 1 : Extraction du buffer JPEG embarqué via exifr.extract ---
    try {
        const extractedBuffer = await exifr.extract(fileBuffer);
        if (extractedBuffer && extractedBuffer.length > 20000) {
            console.log(`✅ RAW (${ext}) extrait via exifr.extract (${(extractedBuffer.length / 1024).toFixed(1)} Ko)`);
            return await toStandardJpegDataUrl(extractedBuffer);
        }
    } catch (errExtract) {
        console.warn(`⚠️ exifr.extract a échoué sur ${ext} :`, errExtract.message);
    }

    // --- ESSAI 2 : Extraction manuelle via les balises TIFF IFD1 (Spécifique Canon .cr2) ---
    try {
        const output = await exifr.parse(fileBuffer, {
            tiff: true,
            ifd1: true,
            exif: true,
            preview: true,
            thumbnail: false
        });

        // exifr renvoie parfois les pointeurs d'image sous différentes clés selon le boîtier
        const candidates = [
            output?.PreviewImage,
            output?.JpgFromRaw,
            output?.JPEGInterchangeFormat,
            output?.StripOffsets
        ];

        for (const cand of candidates) {
            let bufferToTest = null;
            if (Buffer.isBuffer(cand) || cand instanceof Uint8Array) {
                bufferToTest = Buffer.from(cand);
            } else if (typeof cand === 'number' && cand > 0) {
                // Si la balise est un offset numérique, on extrait le buffer depuis l'offset
                const length = output?.JPEGInterchangeFormatLength || output?.StripByteCounts || (fileBuffer.length - cand);
                bufferToTest = fileBuffer.subarray(cand, cand + length);
            }

            if (bufferToTest && bufferToTest.length > 30000) {
                console.log(`✅ RAW (${ext}) extrait via IFD Candidate (${(bufferToTest.length / 1024).toFixed(1)} Ko)`);
                return await toStandardJpegDataUrl(bufferToTest);
            }
        }
    } catch (errIfd) {
        console.warn(`⚠️ Extraction IFD1 a échoué :`, errIfd.message);
    }

    // --- ESSAI 3 : Scan binaire souple avec recherche d'offset EOI flexible ---
    try {
        let largestJpeg = null;
        let maxSize = 0;
        let pos = 0;

        const soiMarker = Buffer.from([0xFF, 0xD8]);
        const eoiMarker = Buffer.from([0xFF, 0xD9]);

        while (pos < fileBuffer.length - 2) {
            const soi = fileBuffer.indexOf(soiMarker, pos);
            if (soi === -1) break;

            // Chercher la fin d'image (EOI) après SOI
            let eoi = fileBuffer.indexOf(eoiMarker, soi + 2);
            
            // Si l'EOI est trouvé, on s'assure qu'on prend le dernier EOI contigu valide
            if (eoi !== -1) {
                const chunk = fileBuffer.subarray(soi, eoi + 2);
                if (chunk.length > 30000 && chunk.length > maxSize) {
                    maxSize = chunk.length;
                    largestJpeg = chunk;
                }
            }

            pos = soi + 2;
        }

        if (largestJpeg) {
            console.log(`✅ RAW (${ext}) extrait via scan binaire souple (${(maxSize / 1024).toFixed(1)} Ko)`);
            return await toStandardJpegDataUrl(largestJpeg);
        }
    } catch (errScan) {
        console.error(`❌ Échec du scan binaire :`, errScan.message);
    }

    throw new Error(`Impossible de trouver une prévisualisation dans ${path.basename(filePath)}`);
}

module.exports = {
    decodeRAWImage,
    SUPPORTED_EXTENSIONS
};