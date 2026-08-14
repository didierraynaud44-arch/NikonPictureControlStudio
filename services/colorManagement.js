/*=========================================================
    Nikon Picture Control Studio - Gestion colorimétrique (export/impression)

    Conversion RÉELLE d'espace colorimétrique via profils ICC (sharp/libvips/
    lcms2), pas une simple étiquette de métadonnées : les canaux du buffer en
    entrée (toujours sRGB non taggé, produit par canvas.toDataURL() côté
    renderer) sont réellement recalculés vers l'espace cible avant réencodage.
    Voir sharp .withIccProfile() : "Transform using an ICC profile and attach
    to the output image."

    🔹 Espaces disponibles : sRGB (implicite, aucun fichier requis) et
    ProPhoto RGB (profil ICC généré PROGRAMMATIQUEMENT, voir
    iccProfileBuilder.js — validé par un parseur ICC indépendant et par
    lcms2/sharp lui-même, voir résumé de la tâche). Adobe RGB a été retiré
    (problème de licence sur le fichier de profil officiel).
=========================================================*/

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { buildProPhotoRGBProfile } = require("./iccProfileBuilder");

const ICC_DIR = path.join(__dirname, "..", "assets", "icc");
const GENERATED_PROPHOTO_PATH = path.join(ICC_DIR, "ProPhotoRGB-generated.icc");

/**
 * 🔹 Le profil ProPhoto RGB est généré programmatiquement (iccProfileBuilder.js)
 * puis mis en cache sur disque : sharp.withIccProfile() n'accepte qu'un chemin
 * de fichier ou un nom de profil intégré, pas un Buffer directement — on écrit
 * donc le profil une seule fois (régénéré si le fichier a disparu) et on
 * réutilise ensuite ce chemin.
 * @returns {string} chemin du fichier .icc généré
 */
function getGeneratedProPhotoProfilePath() {
    if (!fs.existsSync(GENERATED_PROPHOTO_PATH)) {
        fs.mkdirSync(ICC_DIR, { recursive: true });
        fs.writeFileSync(GENERATED_PROPHOTO_PATH, buildProPhotoRGBProfile());
    }
    return GENERATED_PROPHOTO_PATH;
}

function getIccProfilePath(colorSpace) {
    if (colorSpace === "prophoto") return getGeneratedProPhotoProfilePath();
    return null;
}

/**
 * @returns {{prophoto: boolean}} le profil ProPhoto est généré à la demande,
 * donc toujours disponible (sauf erreur d'écriture disque, peu probable).
 */
function checkIccProfilesAvailability() {
    try {
        getGeneratedProPhotoProfilePath();
        return { prophoto: true };
    } catch (err) {
        console.error("❌ Impossible de générer le profil ICC ProPhoto RGB :", err);
        return { prophoto: false };
    }
}

/**
 * Convertit imageBuffer (JPEG/PNG/WebP quelconque, sRGB implicite) vers l'espace
 * colorimétrique cible et réencode dans le format déterminé par `ext`.
 * Retourne le buffer D'ORIGINE (inchangé) si colorSpace est "srgb"/absent, ou si
 * le profil ICC correspondant est indisponible (repli sûr : jamais d'étiquette
 * mensongère sur des pixels non convertis).
 *
 * @param {Buffer} imageBuffer
 * @param {string} colorSpace - "srgb" | "prophoto"
 * @param {string} ext - ".jpg" | ".png" | ".webp" | ".tif" (détermine le réencodage)
 * @param {number} [quality=0.9] - 0..1
 * @returns {Promise<{buffer: Buffer, converted: boolean, reason?: string, expectedPath?: string}>}
 */
async function convertBufferColorSpace(imageBuffer, colorSpace, ext, quality = 0.9) {
    if (!colorSpace || colorSpace === "srgb") {
        return { buffer: imageBuffer, converted: false };
    }

    let iccPath;
    try {
        iccPath = getIccProfilePath(colorSpace);
    } catch (err) {
        iccPath = null;
    }

    if (!iccPath || !fs.existsSync(iccPath)) {
        console.warn(`⚠️ Profil ICC introuvable/impossible à générer pour "${colorSpace}". Export réalisé en sRGB, non converti.`);
        return { buffer: imageBuffer, converted: false, reason: "icc-missing", expectedPath: iccPath };
    }

    try {
        let pipeline = sharp(imageBuffer, { failOnError: false }).withIccProfile(iccPath);
        const qualityPercent = Math.round(Math.max(0, Math.min(1, quality)) * 100) || 90;

        switch ((ext || "").toLowerCase()) {
            case ".jpg":
            case ".jpeg":
                pipeline = pipeline.jpeg({ quality: qualityPercent });
                break;
            case ".png":
                pipeline = pipeline.png();
                break;
            case ".webp":
                pipeline = pipeline.webp({ quality: qualityPercent });
                break;
            case ".tif":
            case ".tiff":
                pipeline = pipeline.tiff();
                break;
            default:
                pipeline = pipeline.jpeg({ quality: qualityPercent });
        }

        const buffer = await pipeline.toBuffer();
        return { buffer, converted: true };
    } catch (err) {
        console.error("❌ Erreur conversion ICC :", err);
        return { buffer: imageBuffer, converted: false, reason: "conversion-error", error: err.message };
    }
}

module.exports = {
    convertBufferColorSpace,
    getIccProfilePath,
    checkIccProfilesAvailability,
    getGeneratedProPhotoProfilePath
};
