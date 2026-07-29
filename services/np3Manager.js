const fs = require("fs");
// Importation sécurisée du module Nikon
const nikonLib = require("nikon-flexible-color-picture-control");

// Support flexible selon la version du package
const parse = nikonLib.parse || nikonLib.deserialize || nikonLib;
const serialize = nikonLib.serialize || nikonLib.encode;

/* =======================================================
   1. Lecture d'un fichier NP3 / NCP
======================================================= */
async function loadNP3(filePath) {
    try {
        console.log("🔍 [np3Manager] Chargement du fichier :", filePath);
        const buffer = fs.readFileSync(filePath);

        // Appel sécurisé du parser
        const parsedData = typeof parse === "function" ? parse(buffer) : nikonLib(buffer); 
        return parsedData;
    } catch (err) {
        console.error("❌ [np3Manager] Erreur lecture fichier :", err);
        throw err;
    }
}


/* =======================================================
   2. Sauvegarde au format NP3 (Z50 II, Z8, Z9...)
======================================================= */
/* =======================================================
   2. Sauvegarde au format NP3 (Nikon Z50 II / EXPEED 7)
======================================================= */
async function saveNP3(pcData) {
    try {
        console.log("🔍 [np3Manager] Génération .NP3 pour Z50 II...");

        if (!pcData) throw new Error("Données pcData vides.");

        let dataToSerialize = pcData.pictureControl ? { ...pcData.pictureControl } : { ...pcData };

        // Détection N&B
        const isMono = 
            dataToSerialize.saturation <= -100 ||
            dataToSerialize.name?.toLowerCase().includes("mono") || 
            dataToSerialize.name?.toLowerCase().includes("n&b") ||
            dataToSerialize.name?.toLowerCase().includes("black");

        if (isMono) {
            // 🎯 Nettoyage des interférences couleur pour forcer le Z50 II
            delete dataToSerialize.colorBlender;
            delete dataToSerialize.colorGrading;

            // Injection forcée du moteur Monochrome PC 3.0
            dataToSerialize.basePictureControl = "Monochrome";
            dataToSerialize.isMonochrome = true;
            dataToSerialize.saturation = -100;

            dataToSerialize.monochrome = {
                filmGrain: 0,
                filterEffect: "None",
                toningEffect: "None"
            };
        }

        const binaryArray = serialize(dataToSerialize);

        if (!binaryArray || binaryArray.length === 0) {
            throw new Error("Erreur de génération binaire NP3.");
        }

        console.log(`✅ [np3Manager] Fichier .NP3 généré | Mode Mono: ${isMono}`);
        return Buffer.from(binaryArray);

    } catch (err) {
        console.error("❌ [np3Manager] Erreur génération NP3 :", err);
        throw err;
    }
}
/* =======================================================
   3. Sauvegarde au format NCP (Nikon Z6 II)
======================================================= */
/**
 * Encode un Picture Control au format .NCP pour Z6 II (Force le mode Monochrome binaire)
 * @param {Object} pcData - Données du profil
 * @returns {Promise<Buffer>} Buffer binaire .NCP
 */
async function saveNCP(pcData) {
    try {
        console.log("🔍 [np3Manager] Génération d'un fichier .NCP pour Z6 II...");

        if (!pcData) throw new Error("Données pcData vides.");

        let dataToSerialize = pcData.pictureControl ? { ...pcData.pictureControl } : { ...pcData };

        // 1. Nettoyage des clés avancées PC3
        delete dataToSerialize.colorBlender;
        delete dataToSerialize.colorGrading;
        delete dataToSerialize.isMonochrome;
        delete dataToSerialize.monochrome;
        delete dataToSerialize.basePictureControl;

        // 2. Détection N&B
        const isMono = 
            dataToSerialize.name?.toLowerCase().includes("mono") || 
            dataToSerialize.name?.toLowerCase().includes("n&b") ||
            dataToSerialize.saturation === -100;

        if (isMono) {
            dataToSerialize.saturation = -100;
        }

        // 3. Sérialisation binaire
        const binaryArray = serialize(dataToSerialize);

        if (!binaryArray || binaryArray.length === 0) {
            throw new Error("Erreur de génération binaire NCP.");
        }

        let buffer = Buffer.from(binaryArray);
        
        // 4. Patch Header Z6 II
        buffer.write("NCP         0310", 0, 16, 'ascii');

        // 5. 🎯 PATCH BINAIRE N&B : Si N&B, on force le type d'ID de base sur 0x03 (Monochrome)
        if (isMono) {
            // L'octet du type de Picture Control de base se trouve à l'offset 18 (0x12)
            buffer.writeUInt8(0x03, 18);
        }

        console.log(`✅ [np3Manager] Fichier .NCP généré (${buffer.length} octets) | Mode Mono: ${isMono}`);
        return buffer;

    } catch (err) {
        console.error("❌ [np3Manager] Erreur lors de la génération NCP :", err);
        throw err;
    }
}

/* =======================================================
   4. Utilitaires de réglages (optionnels selon ton app)
======================================================= */
function setSharpness(pc, value) { if(pc) pc.sharpening = value; }
function setContrast(pc, value) { if(pc) pc.contrast = value; }
function setHighlights(pc, value) { if(pc) pc.highlights = value; }
function setSaturation(pc, value) { if(pc) pc.saturation = value; }

/* =======================================================
   5. Exportation de TOUTES les fonctions
======================================================= */
module.exports = {
    loadNP3,       // <-- C'est lui qui causait l'erreur !
    saveNP3,
    saveNCP,
    setSharpness,
    setContrast,
    setHighlights,
    setSaturation
};