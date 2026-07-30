const path = require('path');
const fs = require('fs');
const exifr = require('exifr');
const sharp = require('sharp');
const { exiftool } = require('exiftool-vendored');

const SUPPORTED_EXTENSIONS = ['.nef', '.cr2', '.cr3', '.raf', '.arw', '.rw2', '.dng', '.pef', '.orf'];

/**
 * Tente de convertir et valider un buffer JPEG via Sharp
 */
async function toStandardJpegDataUrl(buffer) {
    if (!buffer || buffer.length < 5000) return null;

    // Vérification de la signature JPEG (0xFFD8)
    if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;

    try {
        const cleanBuffer = await sharp(buffer)
            .rotate() // Orientation EXIF automatique
            .jpeg({ quality: 90 })
            .toBuffer();

        return `data:image/jpeg;base64,${cleanBuffer.toString('base64')}`;
    } catch (err) {
        return null;
    }
}

/**
 * Extrait le JPEG embarqué d'un fichier Sony (.ARW) via exiftool.
 * exiftool lit la vraie structure TIFF/IFD du fichier et connaît l'offset
 * et la longueur EXACTS du preview (PreviewImage ou JpgFromRaw selon le
 * modèle). Contrairement à un scan binaire par marqueurs FFD8/FFD9, ça ne
 * peut pas tomber sur un faux positif à l'intérieur des données RAW
 * compressées (qui contiennent souvent des séquences d'octets qui
 * ressemblent par hasard à des marqueurs JPEG).
 */
async function extractSonyArwPreview(filePath) {
    // Sony stocke la preview pleine résolution sous PreviewImage, et parfois
    // sous JpgFromRaw pour certains modèles/générations. On tente les deux,
    // dans l'ordre de préférence (PreviewImage = généralement la plus grande).
    const tagsToTry = ['PreviewImage', 'JpgFromRaw', 'ThumbnailImage'];

    for (const tag of tagsToTry) {
        try {
            const buffer = await exiftool.extractBinaryTagToBuffer(tag, filePath);
            if (buffer && buffer.length > 10000) {
                const res = await toStandardJpegDataUrl(buffer);
                if (res) {
                    console.log(`✅ RAW Sony (.arw) extrait via exiftool [${tag}] (${(buffer.length / 1024).toFixed(1)} Ko)`);
                    return res;
                }
            }
        } catch (e) {
            // Tag absent pour ce fichier/modèle : on essaie le suivant, c'est normal.
            console.warn(`⚠️ exiftool: tag ${tag} indisponible sur ce fichier ARW (${e.message})`);
        }
    }

    return null;
}

/**
 * Extrait le JPEG embarqué d'un fichier Fujifilm (.RAF)
 */
function extractFujiPreview(fileBuffer) {
    const headerStr = fileBuffer.subarray(0, 15).toString('ascii');
    if (!headerStr.startsWith('FUJIFILM')) return null;

    try {
        if (fileBuffer.length > 100) {
            const jpegOffset = fileBuffer.readUInt32BE(0x5C);
            const jpegLength = fileBuffer.readUInt32BE(0x60);

            if (jpegOffset > 0 && jpegLength > 10000 && (jpegOffset + jpegLength) <= fileBuffer.length) {
                const jpegBuffer = fileBuffer.subarray(jpegOffset, jpegOffset + jpegLength);
                if (jpegBuffer[0] === 0xFF && jpegBuffer[1] === 0xD8) {
                    return jpegBuffer;
                }
            }
        }
    } catch (errHeader) {
        console.warn(`⚠️ Lecture d'en-tête RAF échouée...`, errHeader.message);
    }

    return null;
}

/**
 * Extrait la prévisualisation JPEG intégrée dans le RAW multi-marques
 */
async function decodeRAWImage(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        throw new Error(`Extension non prise en charge : ${ext}`);
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`Fichier introuvable : ${filePath}`);
    }

    // --- CAS SPÉCIAL 1 : FUJIFILM (.RAF) ---
    if (ext === '.raf') {
        try {
            const fileBuffer = await fs.promises.readFile(filePath);
            const fujiJpeg = extractFujiPreview(fileBuffer);
            if (fujiJpeg) {
                const res = await toStandardJpegDataUrl(fujiJpeg);
                if (res) {
                    console.log(`✅ RAW Fuji (.raf) extrait via Header Native (${(fujiJpeg.length / 1024).toFixed(1)} Ko)`);
                    return res;
                }
            }
        } catch (errFuji) {
            console.warn(`⚠️ Échec décodage spécifique Fuji :`, errFuji.message);
        }
    }

    // --- CAS SPÉCIAL 2 : SONY (.ARW) — via exiftool, plus de scan binaire ---
    if (ext === '.arw') {
        try {
            const sonyRes = await extractSonyArwPreview(filePath);
            if (sonyRes) {
                return sonyRes;
            }
        } catch (errSony) {
            console.warn(`⚠️ Échec décodage spécifique Sony :`, errSony.message);
        }
        // Si exiftool échoue totalement (fichier vraiment atypique), on continue
        // vers les essais généraux ci-dessous plutôt que d'abandonner.
    }

    const fileBuffer = await fs.promises.readFile(filePath);

    // --- ESSAI GENERAL 1 : exifr.thumbnail (Nikon .nef, Canon .cr2, Adobe .dng) ---
    // Note : exifr 7.x a renommé l'ancienne fonction `extract()` en `thumbnail()`.
    try {
        const extractedBuffer = await exifr.thumbnail(fileBuffer);
        const res = await toStandardJpegDataUrl(extractedBuffer);
        if (res) {
            console.log(`✅ RAW (${ext}) extrait via exifr.thumbnail (${(extractedBuffer.length / 1024).toFixed(1)} Ko)`);
            return res;
        }
    } catch (errExtract) {
        console.warn(`⚠️ exifr.thumbnail a échoué sur ${ext} :`, errExtract.message);
    }

    // --- ESSAI GENERAL 2 : Inspection IFD / SubIFD / Offsets (Autres formats) ---
    try {
        const output = await exifr.parse(fileBuffer, {
            tiff: true,
            ifd0: true,
            ifd1: true,
            exif: true,
            subifd: true,
            preview: true,
            thumbnail: false
        });

        const rawCandidates = [
            output?.PreviewImage,
            output?.JpgFromRaw,
            output?.JPEGInterchangeFormat
        ];

        for (const cand of rawCandidates) {
            if (!cand) continue;

            let bufferToTest = null;
            if (Buffer.isBuffer(cand) || cand instanceof Uint8Array) {
                bufferToTest = Buffer.from(cand);
            } else if (typeof cand === 'number' && cand > 0 && cand < fileBuffer.length) {
                const length = output?.JPEGInterchangeFormatLength || (fileBuffer.length - cand);
                bufferToTest = fileBuffer.subarray(cand, cand + length);
            }

            if (bufferToTest) {
                const res = await toStandardJpegDataUrl(bufferToTest);
                if (res) {
                    console.log(`✅ RAW (${ext}) extrait via IFD Offset (${(bufferToTest.length / 1024).toFixed(1)} Ko)`);
                    return res;
                }
            }
        }
    } catch (errIfd) {
        console.warn(`⚠️ Extraction SubIFD/IFD a échoué :`, errIfd.message);
    }

    // --- ESSAI GENERAL 3 : exiftool en dernier recours pour TOUT format ---
    // Plus fiable que le scan binaire pour tous les formats, pas seulement Sony.
    try {
        for (const tag of ['PreviewImage', 'JpgFromRaw', 'ThumbnailImage']) {
            try {
                const buffer = await exiftool.extractBinaryTagToBuffer(tag, filePath);
                if (buffer && buffer.length > 10000) {
                    const res = await toStandardJpegDataUrl(buffer);
                    if (res) {
                        console.log(`✅ RAW (${ext}) extrait via exiftool fallback [${tag}] (${(buffer.length / 1024).toFixed(1)} Ko)`);
                        return res;
                    }
                }
            } catch (e) {
                // tag absent, on continue
            }
        }
    } catch (errExiftool) {
        console.warn(`⚠️ exiftool fallback a échoué :`, errExiftool.message);
    }

    throw new Error(`Impossible de trouver une prévisualisation dans ${path.basename(filePath)}`);
}

/**
 * À appeler une seule fois à la fermeture de l'application (ex: dans
 * app.on('will-quit', ...) côté main.js) pour terminer proprement le
 * process exiftool persistant et éviter un process zombie.
 */
async function shutdownExiftool() {
    try {
        await exiftool.end();
    } catch (e) {
        console.warn('⚠️ Fermeture exiftool :', e.message);
    }
}

module.exports = {
    decodeRAWImage,
    shutdownExiftool,
    SUPPORTED_EXTENSIONS
};
