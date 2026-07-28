const fs = require("fs");
const { deserialize, serialize } = require("nikon-flexible-color-picture-control");

/**
 * Lit et décode un fichier binaire .NP3 Nikon vers un objet JavaScript
 * @param {string} filePath - Chemin absolu du fichier .NP3
 * @returns {Object} Objet JavaScript représentant le Picture Control
 */
function loadNP3(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        const pc = deserialize(buffer);

        console.log("===== NP3 chargé avec succès =====");
        console.log(pc);

        return pc;
    } catch (err) {
        console.error("❌ [np3Manager] Erreur lors de la lecture du fichier NP3 :", err);
        throw err;
    }
}

/**
 * Encode un objet JavaScript Picture Control vers un Buffer binaire .NP3 Nikon
 * @param {Object} pcData - Les données du Picture Control à encoder
 * @returns {Promise<Buffer>} Buffer binaire prêt à être écrit sur le disque
 */
async function saveNP3(pcData) {
    try {
        console.log("🔍 [np3Manager] Traitement des données pour sérialisation...");

        if (!pcData) {
            throw new Error("Les données pcData fournies sont vides ou indéfinies.");
        }

        // Si l'objet est encapsulé sous la clé { pictureControl: ... }, on extrait le sous-objet
        const dataToSerialize = pcData.pictureControl ? pcData.pictureControl : pcData;

        // Conversion en structure binaire Uint8Array via la librairie Nikon
        const binaryArray = serialize(dataToSerialize);

        if (!binaryArray || binaryArray.length === 0) {
            throw new Error("La sérialisation binaire a produit un résultat vide.");
        }

        console.log(`✅ [np3Manager] Encoded avec succès (${binaryArray.length} octets)`);

        // Transformation du Uint8Array en Buffer exploitable par Node.js (fs.writeFileSync)
        return Buffer.from(binaryArray);
    } catch (err) {
        console.error("❌ [np3Manager] Erreur lors de la sérialisation binaire NP3 :", err);
        throw err;
    }
}

/* =======================================================
   Fonctions utilitaires de modification directe d'objet
======================================================= */

function setSharpness(pc, value) {
    pc.sharpning = value;
}

function setContrast(pc, value) {
    pc.contrast = value;
}

function setHighlights(pc, value) {
    pc.highlights = value;
}

function setSaturation(pc, value) {
    pc.saturation = value;
}

/* =======================================================
   Export unique du module
======================================================= */

module.exports = {
    loadNP3,
    saveNP3,
    setSharpness,
    setContrast,
    setHighlights,
    setSaturation
};