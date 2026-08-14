/*=========================================================
    Nikon Picture Control Studio - Générateur de profil ICC ProPhoto RGB

    Construit un profil ICC v4 (matrice/TRC, classe Display 'mntr') pour
    ProPhoto RGB ENTIÈREMENT EN JS PUR, sans dépendance native ni fichier
    externe à fournir. Aucune bibliothèque npm de génération de profils ICC
    en JS pur n'a été trouvée (voir résumé de la tâche) : ce module implémente
    directement le format binaire ICC.1:2022 (structure header/tag table/tag
    data, types XYZType / curveType / multiLocalizedUnicodeType), PAS une
    solution improvisée — chaque champ suit précisément la spécification
    officielle (color.org, ICC.1:2022) et les valeurs colorimétriques
    officielles de ROMM RGB / ProPhoto RGB (ISO 22028-2:2013, voir
    registry.color.org/rgb-registry/files/ROMMRGB.pdf).

    Valeurs officielles ROMM RGB (source : ROMMRGB.pdf, ISO 22028-2:2013,
    section "Hints for Profile makers" — tristimulus XYZ des primaires et du
    blanc, déjà normalisés pour Y=1, directement utilisables comme colorant
    tags rXYZ/gXYZ/bXYZ) :
        Primaire rouge : X=0.7977, Y=0.2881, Z=0.0
        Primaire verte : X=0.1352, Y=0.7118, Z=0.0
        Primaire bleue : X=0.0314, Y=0.0001, Z=0.8249
        Blanc D50      : X=0.9642, Y=1.00,   Z=0.8249
        Gamma : 1.8 (courbe simple, comme la quasi-totalité des profils
        ProPhoto RGB réels distribués — la spec ISO propose en option un
        raccord linéaire pour les valeurs très proches de 0, non implémenté
        ici : impact négligeable sur un export photo, voir résumé).
=========================================================*/

// 🔹 Constantes colorimétriques OFFICIELLES ROMM RGB / ProPhoto RGB
// (ISO 22028-2:2013 via registry.color.org — ne pas modifier sans revérifier
// la spec officielle).
const ROMM_RGB = {
    red:   { X: 0.7977, Y: 0.2881, Z: 0.0 },
    green: { X: 0.1352, Y: 0.7118, Z: 0.0 },
    blue:  { X: 0.0314, Y: 0.0001, Z: 0.8249 },
    white: { X: 0.9642, Y: 1.0,    Z: 0.8249 }, // D50, identique à l'illuminant PCS ICC
    gamma: 1.8
};

function align4(len) {
    return (len + 3) & ~3;
}

function padTo4(buf) {
    const target = align4(buf.length);
    if (target === buf.length) return buf;
    return Buffer.concat([buf, Buffer.alloc(target - buf.length)]);
}

function s15Fixed16(value) {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(Math.round(value * 65536));
    return buf;
}

function u8Fixed8(value) {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(Math.round(value * 256));
    return buf;
}

/** XYZType (ICC.1:2022 §10.31) : sig 'XYZ ' + reserved(4) + 1 XYZNumber (3×s15Fixed16). */
function buildXYZTag({ X, Y, Z }) {
    const buf = Buffer.alloc(20);
    buf.write("XYZ ", 0, "ascii");
    buf.writeUInt32BE(0, 4);
    s15Fixed16(X).copy(buf, 8);
    s15Fixed16(Y).copy(buf, 12);
    s15Fixed16(Z).copy(buf, 16);
    return buf;
}

/** curveType (ICC.1:2022 §10.6), cas n=1 : sig 'curv' + reserved(4) + count=1(4) + gamma en u8Fixed8Number(2), padé à 4 octets. */
function buildGammaCurveTag(gamma) {
    const buf = Buffer.alloc(14);
    buf.write("curv", 0, "ascii");
    buf.writeUInt32BE(0, 4);
    buf.writeUInt32BE(1, 8);
    u8Fixed8(gamma).copy(buf, 12);
    return padTo4(buf);
}

/**
 * multiLocalizedUnicodeType (ICC.1:2022 §10.15), un seul enregistrement en/US :
 * sig 'mluc' + reserved(4) + nbRecords=1(4) + tailleRecord=12(4) +
 * [langue(2)+pays(2)+longueur(4)+offset(4)] + chaîne UTF-16BE.
 */
function buildMlucTag(text) {
    const strBuf = Buffer.from(text, "utf16le").swap16(); // UTF-16BE requis par la spec
    const buf = Buffer.alloc(28 + strBuf.length);
    buf.write("mluc", 0, "ascii");
    buf.writeUInt32BE(0, 4);
    buf.writeUInt32BE(1, 8);   // nombre d'enregistrements
    buf.writeUInt32BE(12, 12); // taille d'un enregistrement
    buf.write("en", 16, "ascii");
    buf.write("US", 18, "ascii");
    buf.writeUInt32BE(strBuf.length, 20); // longueur de la chaîne, en octets
    buf.writeUInt32BE(28, 24);            // offset de la chaîne depuis le début du tag
    strBuf.copy(buf, 28);
    return padTo4(buf);
}

/**
 * Construit un profil ICC v4.3 complet, classe Display ('mntr'), RGB matrice/TRC,
 * pour ProPhoto RGB. Suit ICC.1:2022 §7 (header), §8.4.3 (tags requis pour un
 * profil Display matrice/TRC 3 composantes) et §9-10 (types de tags).
 * @returns {Buffer}
 */
function buildProPhotoRGBProfile() {
    const descTag = buildMlucTag("ProPhoto RGB");
    const cprtTag = buildMlucTag("Public domain - genere programmatiquement depuis les valeurs officielles ROMM RGB (ISO 22028-2:2013)");
    const wtptTag = buildXYZTag(ROMM_RGB.white);
    const rXYZTag = buildXYZTag(ROMM_RGB.red);
    const gXYZTag = buildXYZTag(ROMM_RGB.green);
    const bXYZTag = buildXYZTag(ROMM_RGB.blue);
    const trcTag = buildGammaCurveTag(ROMM_RGB.gamma); // partagée par rTRC/gTRC/bTRC (gamma identique sur les 3 canaux)

    // 🔹 Ordre des blocs de données UNIQUES (le tag table, lui, aura 9 entrées :
    // rTRC/gTRC/bTRC pointeront tous les trois vers le même bloc `trcTag`).
    const uniqueBlocks = [
        { data: descTag },
        { data: cprtTag },
        { data: wtptTag },
        { data: rXYZTag },
        { data: gXYZTag },
        { data: bXYZTag },
        { data: trcTag }
    ];

    const TAG_COUNT = 9;
    const HEADER_SIZE = 128;
    const TAG_TABLE_SIZE = 4 + TAG_COUNT * 12;
    const dataStart = HEADER_SIZE + TAG_TABLE_SIZE;

    // 🔹 Calcule l'offset (depuis le début du profil) de chaque bloc unique.
    let cursor = dataStart;
    const offsets = uniqueBlocks.map(block => {
        const offset = cursor;
        cursor += block.data.length;
        return offset;
    });
    const totalSize = cursor;

    // 🔹 Table des tags : 9 entrées, rTRC/gTRC/bTRC partagent l'entrée `trcTag`.
    const entries = [
        { sig: "desc", offset: offsets[0], size: descTag.length },
        { sig: "cprt", offset: offsets[1], size: cprtTag.length },
        { sig: "wtpt", offset: offsets[2], size: wtptTag.length },
        { sig: "rXYZ", offset: offsets[3], size: rXYZTag.length },
        { sig: "gXYZ", offset: offsets[4], size: gXYZTag.length },
        { sig: "bXYZ", offset: offsets[5], size: bXYZTag.length },
        { sig: "rTRC", offset: offsets[6], size: trcTag.length },
        { sig: "gTRC", offset: offsets[6], size: trcTag.length },
        { sig: "bTRC", offset: offsets[6], size: trcTag.length }
    ];

    // 🔹 En-tête (ICC.1:2022 §7.2, 128 octets)
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32BE(totalSize, 0);       // 0-3   : taille totale du profil
    header.writeUInt32BE(0, 4);               // 4-7   : CMM préféré (aucun)
    header.writeUInt8(4, 8);                  // 8     : version majeure
    header.writeUInt8(0x30, 9);               // 9     : version mineure.correctif (3.0) -> v4.3.0.0
    header.writeUInt16BE(0, 10);              // 10-11 : réservé
    header.write("mntr", 12, "ascii");        // 12-15 : classe de profil (Display)
    header.write("RGB ", 16, "ascii");        // 16-19 : espace couleur des données
    header.write("XYZ ", 20, "ascii");        // 20-23 : PCS
    const now = new Date();
    header.writeUInt16BE(now.getUTCFullYear(), 24);
    header.writeUInt16BE(now.getUTCMonth() + 1, 26);
    header.writeUInt16BE(now.getUTCDate(), 28);
    header.writeUInt16BE(now.getUTCHours(), 30);
    header.writeUInt16BE(now.getUTCMinutes(), 32);
    header.writeUInt16BE(now.getUTCSeconds(), 34);
    header.write("acsp", 36, "ascii");        // 36-39 : signature de fichier profil
    header.writeUInt32BE(0, 40);              // 40-43 : plateforme primaire (aucune)
    header.writeUInt32BE(0, 44);              // 44-47 : indicateurs de profil
    header.writeUInt32BE(0, 48);              // 48-51 : fabricant du périphérique
    header.writeUInt32BE(0, 52);              // 52-55 : modèle du périphérique
    header.writeUInt32BE(0, 56);              // 56-63 : attributs du périphérique
    header.writeUInt32BE(0, 60);
    header.writeUInt32BE(0, 64);              // 64-67 : intention de rendu (0 = perceptuel)
    // 68-79 : illuminant PCS = D50 (mêmes valeurs que le blanc média, ICC.1:2022 §7.2.16)
    s15Fixed16(0.9642).copy(header, 68);
    s15Fixed16(1.0).copy(header, 72);
    s15Fixed16(0.8249).copy(header, 76);
    header.writeUInt32BE(0, 80);              // 80-83 : créateur du profil
    // 84-99 : ID de profil (MD5), laissé à zéro = "non calculé" (explicitement valide, §7.2.18)
    // 100-127 : réservé, déjà à zéro

    // 🔹 Table des tags
    const tagTable = Buffer.alloc(TAG_TABLE_SIZE);
    tagTable.writeUInt32BE(TAG_COUNT, 0);
    entries.forEach((entry, i) => {
        const off = 4 + i * 12;
        tagTable.write(entry.sig, off, "ascii");
        tagTable.writeUInt32BE(entry.offset, off + 4);
        tagTable.writeUInt32BE(entry.size, off + 8);
    });

    return Buffer.concat([header, tagTable, ...uniqueBlocks.map(b => b.data)]);
}

module.exports = { buildProPhotoRGBProfile, ROMM_RGB };
