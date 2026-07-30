const path = require('path');
const fs = require('fs');
const exifr = require('exifr');
const sharp = require('sharp');

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
 * Extrait spécifiquement le JPEG embarqué d'un fichier Sony (.ARW)
 * en combinant la recherche de l'en-tête SR2/ARW et la balise PreviewImage
 */
async function extractSonyArwPreview(fileBuffer) {
    // 1. Essai d'extraction via exifr avec options Sony poussées
    try {
        const parsed = await exifr.parse(fileBuffer, {
            tiff: true,
            ifd0: true,
            ifd1: true,
            exif: true,
            gps: false,
            mergeOutput: true
        });

        if (parsed) {
            // Sony stocke souvent le JPEG principal sous ces clés
            const keys = ['PreviewImage', 'JpgFromRaw', 'ThumbnailImage'];
            for (const key of keys) {
                if (parsed[key] && parsed[key] instanceof Uint8Array && parsed[key].length > 10000) {
                    const res = await toStandardJpegDataUrl(Buffer.from(parsed[key]));
                    if (res) return res;
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Parsing EXIF Sony échoué :', e.message);
    }

    // 2. Scan binaire spécifique Sony ARW :
    // Sony place le JPEG principal dans un bloc TIFF secondaire qui commence par 0xFFD8FFE1 ou 0xFFD8FFE0
    let pos = 0;
    const soiMarker = Buffer.from([0xFF, 0xD8]);
    let largestValidJpeg = null;
    let maxSize = 0;

    while (pos < fileBuffer.length - 2) {
        const soi = fileBuffer.indexOf(soiMarker, pos);
        if (soi === -1) break;

        // On cherche le marqueur EOI 0xFFD9
        const eoiMarker = Buffer.from([0xFF, 0xD9]);
        const eoi = fileBuffer.indexOf(eoiMarker, soi + 2);

        if (eoi !== -1) {
            const chunk = fileBuffer.subarray(soi, eoi + 2);
            if (chunk.length > 20000 && chunk.length > maxSize) {
                const res = await toStandardJpegDataUrl(chunk);
                if (res) {
                    maxSize = chunk.length;
                    largestValidJpeg = res;
                }
            }
        }

        pos = soi + 2;
    }

    return largestValidJpeg;
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

    const fileBuffer = await fs.promises.readFile(filePath);

    // --- CAS SPÉCIAL 1 : FUJIFILM (.RAF) ---
    if (ext === '.raf') {
        try {
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

    /**
 * Extrait spécifiquement le JPEG embarqué d'un fichier Sony (.ARW)
 * Version améliorée avec détection plus robuste
 */
async function extractSonyArwPreview(fileBuffer) {
    // Stratégie 1 : Utiliser exifr avec des options spécifiques Sony
    try {
        // Sony stocke souvent le JPEG dans IFD0 ou SubIFD
        const parsed = await exifr.parse(fileBuffer, {
            tiff: true,
            ifd0: true,
            ifd1: true,
            subifd: true,
            exif: true,
            gps: false,
            makerNote: true, // Important pour Sony
            mergeOutput: true
        });

        if (parsed) {
            // Clés spécifiques Sony pour l'aperçu
            const sonyPreviewKeys = [
                'PreviewImage',
                'JpgFromRaw', 
                'ThumbnailImage',
                'PreviewImageStart',
                'PreviewImageLength',
                'JPEGInterchangeFormat',
                'JPEGInterchangeFormatLength'
            ];

            // Recherche directe du buffer
            for (const key of ['PreviewImage', 'JpgFromRaw', 'ThumbnailImage']) {
                if (parsed[key]) {
                    const buffer = Buffer.isBuffer(parsed[key]) ? parsed[key] : 
                                   Buffer.from(parsed[key]);
                    if (buffer.length > 10000) {
                        const res = await toStandardJpegDataUrl(buffer);
                        if (res) return res;
                    }
                }
            }

            // Recherche par offset (Sony utilise souvent des offsets)
            if (parsed.PreviewImageStart && parsed.PreviewImageLength) {
                const offset = parsed.PreviewImageStart;
                const length = parsed.PreviewImageLength;
                if (offset > 0 && length > 10000 && (offset + length) <= fileBuffer.length) {
                    const jpegBuffer = fileBuffer.subarray(offset, offset + length);
                    const res = await toStandardJpegDataUrl(jpegBuffer);
                    if (res) return res;
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Parsing EXIF Sony échoué :', e.message);
    }

    // Stratégie 2 : Scan binaire intelligent pour Sony
    // Les fichiers Sony ARW ont une structure particulière
    try {
        // Recherche du marqueur Sony dans les métadonnées
        const sonyMarker = Buffer.from('SONY', 'ascii');
        const dscMarker = Buffer.from('DSC', 'ascii');
        
        // Stratégie : Chercher les JPEGs de grande taille (> 100KB pour l'aperçu principal)
        let bestJpeg = null;
        let maxSize = 0;
        let pos = 0;
        
        while (pos < fileBuffer.length - 2) {
            // Chercher le début d'un JPEG
            if (fileBuffer[pos] === 0xFF && fileBuffer[pos + 1] === 0xD8) {
                // Vérifier si c'est un JPEG valide (APP0 ou APP1 marker)
                if (pos + 4 < fileBuffer.length) {
                    const marker = fileBuffer.readUInt16BE(pos + 2);
                    if (marker === 0xFFE0 || marker === 0xFFE1 || marker === 0xFFDB || marker === 0xFFC0) {
                        // Trouver la fin du JPEG
                        const eoi = findEOI(fileBuffer, pos);
                        if (eoi !== -1) {
                            const chunkSize = eoi - pos + 2;
                            // Sony utilise des JPEGs de taille spécifique pour l'aperçu
                            // Généralement entre 100KB et 5MB
                            if (chunkSize > 100000 && chunkSize > maxSize && chunkSize < 10000000) {
                                const chunk = fileBuffer.subarray(pos, eoi + 2);
                                const res = await toStandardJpegDataUrl(chunk);
                                if (res && chunkSize > maxSize) {
                                    maxSize = chunkSize;
                                    bestJpeg = res;
                                }
                            }
                        }
                    }
                }
            }
            pos++;