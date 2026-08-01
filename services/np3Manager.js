const { parseLegacyNCP, findVersionAnchor } = require("./legacyNcpParser");
const fs = require("fs");
// Importation sécurisée du module Nikon
const nikonLib = require("nikon-flexible-color-picture-control");

const parse = nikonLib.parse || nikonLib.deserialize || nikonLib;
const serialize = nikonLib.serialize || nikonLib.encode;

/* =======================================================
   1. Lecture d'un fichier NP3 / NCP
======================================================= */

const SUPPORTED_FLEXIBLE_VERSIONS = ["0300", "0310"];

function readFlexibleHeader(buffer) {
    if (buffer.length < 16) return null;
    return {
        magic: buffer.toString("ascii", 0, 3),
        version: buffer.toString("ascii", 12, 16)
    };
}

async function loadNP3(filePath) {
    try {
        console.log("🔍 [np3Manager] Chargement du fichier :", filePath);
        const buffer = fs.readFileSync(filePath);

        const flexHeader = readFlexibleHeader(buffer);

        // CAS 1 : format moderne Flexible Color (0300/0310, Z-mount/D6/D780) -> lib npm
        if (flexHeader && flexHeader.magic === "NCP" && SUPPORTED_FLEXIBLE_VERSIONS.includes(flexHeader.version)) {
            console.log("✅ [np3Manager] Format détecté : Flexible Color", flexHeader.version);
            const parsedData = typeof parse === "function" ? parse(buffer) : nikonLib(buffer);
            return parsedData;
        }

        // CAS 2 : tag "0100" détecté mais structure NON confirmée pour l'instant.
        // (Le format réel utilisé par certains générateurs tiers ne correspond
        // ni au conteneur moderne 0300/0310, ni à la structure legacy documentée
        // par ExifTool -> on refuse plutôt que d'afficher des valeurs corrompues.)
        if (findVersionAnchor(buffer) !== -1) {
            throw new Error(
                "Ce fichier utilise un format 0100 dont la structure exacte n'est pas " +
                "encore confirmée pour cet outil tiers. Import refusé par sécurité " +
                "(plutôt que d'afficher des valeurs corrompues type -128)."
            );
        }

        throw new Error("Format de fichier NCP/NP3 non reconnu.");

    } catch (err) {
        console.error("❌ [np3Manager] Erreur lecture fichier :", err);
        throw err;
    }
}

/* =======================================================
   2. Mappage des IDs de Profils Nikon
======================================================= */
const PROFILE_IDS = {
    "STANDARD": 0x01,
    "NEUTRAL": 0x02,
    "VIVID": 0x03,
    "MONOCHROME": 0x04,
    "PORTRAIT": 0x05,
    "LANDSCAPE": 0x06,
    "FLAT": 0x07
};

/* =======================================================
   3. Sauvegarde au format NP3 (Nikon Z50 II / EXPEED 7)
======================================================= */
async function saveNP3(pcData) {
    try {
        console.log("🔍 [np3Manager] Génération .NP3...");

        if (!pcData) throw new Error("Données pcData vides.");

        let src = pcData.pictureControl ? pcData.pictureControl : pcData;
        let dataToSerialize = { ...src };

        // Conservation explicite du nom et du profil de base
        dataToSerialize.name = src.name || src.pictureControlName || "Custom";
        dataToSerialize.basePictureControl = src.baseProfile || src.basePictureControl || "Standard";

        // Détection N&B
        const isMono = 
            dataToSerialize.isMonochrome === true ||
            dataToSerialize.basePictureControl.toUpperCase() === "MONOCHROME";

        if (isMono) {
            delete dataToSerialize.colorBlender;
            delete dataToSerialize.colorGrading;

            dataToSerialize.basePictureControl = "Monochrome";
            dataToSerialize.isMonochrome = true;
            dataToSerialize.saturation = -100;
        }

        const binaryArray = serialize(dataToSerialize);
        if (!binaryArray || binaryArray.length === 0) {
            throw new Error("Erreur de génération binaire NP3.");
        }

        console.log(`✅ [np3Manager] .NP3 généré | Nom: ${dataToSerialize.name} | Base: ${dataToSerialize.basePictureControl}`);
        return Buffer.from(binaryArray);

    } catch (err) {
        console.error("❌ [np3Manager] Erreur génération NP3 :", err);
        throw err;
    }
}

/* =======================================================
   4. Sauvegarde au format NCP (Nikon Z6 II)
======================================================= */
async function saveNCP(pcData) {
    try {
        console.log("🔍 [np3Manager] Génération d'un fichier .NCP pour Z6 II...");

        if (!pcData) throw new Error("Données pcData vides.");

        let src = pcData.pictureControl ? pcData.pictureControl : pcData;
        let dataToSerialize = { ...src };

        const baseName = (src.baseProfile || src.basePictureControl || src.name || "Standard").toUpperCase();

        // On conserve le profil de base pour ne pas retomber sur Standard par défaut !
        dataToSerialize.name = src.name || "Custom";
        dataToSerialize.basePictureControl = baseName;

        // Détection N&B
        const isMono = dataToSerialize.isMonochrome === true || baseName === "MONOCHROME";

        if (isMono) {
            dataToSerialize.saturation = -100;
        }

        // Nettoyage uniquement des clés incompatibles NCP (PC3)
        delete dataToSerialize.colorBlender;
        delete dataToSerialize.colorGrading;

        const binaryArray = serialize(dataToSerialize);
        if (!binaryArray || binaryArray.length === 0) {
            throw new Error("Erreur de génération binaire NCP.");
        }

        let buffer = Buffer.from(binaryArray);
        
        // Patch En-tête Z6 II
        buffer.write("NCP         0310", 0, 16, 'ascii');

        // Patch ID du Profil de Base à l'offset 18 (0x12)
        const profileId = PROFILE_IDS[baseName] || 0x01;
        buffer.writeUInt8(profileId, 18);

        console.log(`✅ [np3Manager] .NCP généré (${buffer.length} octets) | Nom: ${dataToSerialize.name} | Base ID: ${profileId}`);
        return buffer;

    } catch (err) {
        console.error("❌ [np3Manager] Erreur lors de la génération NCP :", err);
        throw err;
    }
}

module.exports = {
    loadNP3,
    saveNP3,
    saveNCP,
    setSharpness: (pc, value) => { if(pc) pc.sharpening = value; },
    setContrast: (pc, value) => { if(pc) pc.contrast = value; },
    setHighlights: (pc, value) => { if(pc) pc.highlights = value; },
    setSaturation: (pc, value) => { if(pc) pc.saturation = value; }
};
