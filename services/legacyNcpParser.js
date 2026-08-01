/* =======================================================
   Parser dédié au format NCP "legacy" Nikon
   (versions 0100 / 0102 / 0103 / 0201-0204)
   Compatible D3/D700/D90/D300/D5000/D7000/D800/D600 etc.
   Structure de référence : ExifTool Nikon.pm
   (table %Image::ExifTool::Nikon::PictureControl)
======================================================= */

/**
 * Cherche le tag de version ASCII (ex: "0100", "0103", "0201"...)
 * dans les 40 premiers octets du buffer. On ne suppose pas d'offset fixe
 * car certains exports ont un léger préfixe/padding avant le bloc.
 */
function findVersionAnchor(buffer) {
    const versionRegex = /^0[0-2]\d{2}$/; // 0100, 0102, 0103, 0201-0204...
    for (let i = 0; i <= 40 && i + 4 <= buffer.length; i++) {
        const candidate = buffer.toString("ascii", i, i + 4);
        if (versionRegex.test(candidate)) {
            return i;
        }
    }
    return -1;
}

function readByteSigned(buffer, offset) {
    const raw = buffer[offset];
    if (raw === undefined) return null;
    if (raw === 0xff) return null; // "n/a" documenté par Nikon/ExifTool
    return raw - 0x80;
}

function readCString(buffer, offset, length) {
    const slice = buffer.slice(offset, offset + length);
    const term = slice.indexOf(0);
    return slice.toString("ascii", 0, term === -1 ? length : term).trim();
}

const FILTER_EFFECTS = { 0x80: "OFF", 0x81: "YELLOW", 0x82: "ORANGE", 0x83: "RED", 0x84: "GREEN" };
const TONING_EFFECTS = {
    0x80: "B&W", 0x81: "SEPIA", 0x82: "CYANOTYPE", 0x83: "RED", 0x84: "YELLOW",
    0x85: "GREEN", 0x86: "BLUE-GREEN", 0x87: "BLUE", 0x88: "PURPLE-BLUE", 0x89: "RED-PURPLE"
};

/**
 * Parse un fichier NCP legacy et retourne un objet normalisé
 * compatible avec le format attendu par pictureControlEngine / ImageProcessor.
 */
function parseLegacyNCP(buffer) {
    const anchor = findVersionAnchor(buffer);
    if (anchor === -1) {
        throw new Error("Impossible de localiser le tag de version Picture Control legacy dans ce fichier.");
    }

    const version = buffer.toString("ascii", anchor, anchor + 4);
    const name = readCString(buffer, anchor + 4, 20);
    const base = readCString(buffer, anchor + 24, 20).toUpperCase() || "STANDARD";

    const sharpnessRaw = buffer[anchor + 50];
    const sharpening = sharpnessRaw === 0xff ? 3 : (sharpnessRaw - 0x80); // défaut Nikon = 3
    const contrast = readByteSigned(buffer, anchor + 51) ?? 0;
    const brightness = readByteSigned(buffer, anchor + 52) ?? 0;
    const saturationRaw = readByteSigned(buffer, anchor + 53);
    const hue = readByteSigned(buffer, anchor + 54) ?? 0;

    const filterByte = buffer[anchor + 55];
    const toningByte = buffer[anchor + 56];
    const toningAmount = readByteSigned(buffer, anchor + 57) ?? 1;

    const isMonochrome = base === "MONOCHROME";

    return {
        name: name || base,
        pictureControlName: name || base,
        baseProfile: base,
        basePictureControl: base,
        isMonochrome,

        sharpening,
        sharpning: sharpening, // compat orthographe app
        midRangeSharpening: 0, // absent du format legacy
        midRangeSharpning: 0,
        clarity: 0,            // absent du format legacy

        contrast,
        brightness,
        saturation: isMonochrome ? -100 : (saturationRaw ?? 0),
        hue,

        filterEffect: filterByte !== undefined ? (FILTER_EFFECTS[filterByte] || "OFF") : "OFF",
        toningEffect: toningByte !== undefined ? (TONING_EFFECTS[toningByte] || "B&W") : "B&W",
        toningAmount,

        // Champs modernes absents en legacy -> valeurs neutres
        highlights: 0, shadows: 0, dehaze: 0, vibrance: 0, vignette: 0, denoise: 0,

        _sourceFormat: `legacy-${version}`
    };
}

module.exports = { parseLegacyNCP, findVersionAnchor };
