/*=========================================================
    Pixel RAW - Monochrome Manager
    Module Monochrome dédié du Studio (mixeur N&B, Lumière tamisée,
    courbe de contraste, Dodge & Burn) — indépendant du profil Nikon
    Monochrome et des systèmes de masques/retouche, mais suit le même
    modèle de persistance/historique (undo/redo) que MasksManager.js
    et RetouchManager.js.
=========================================================*/

(function () {

// 🔹 Les 10 cibles indépendantes de la Gomme locale : les 8 canaux du
// mixeur N&B, puis Dodge & Burn, puis Punch (Lumière tamisée + courbe de
// contraste, réduites ensemble sous une seule cible "Punch").
const ERASE_TARGETS = [
    "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta",
    "dodgeBurn", "punch"
];

function makeDefaultEraseMasks() {
    const masks = {};
    for (const key of ERASE_TARGETS) {
        masks[key] = { geometry: { strokes: [] }, intensity: 100 };
    }
    return masks;
}

const DEFAULT_SETTINGS = {
    monoMixerEnabled: false,

    // Mixeur N&B 8 canaux (valeurs par défaut identiques à Photoshop)
    monoMixerRed: 40,
    monoMixerOrange: 0,
    monoMixerYellow: 60,
    monoMixerGreen: 40,
    monoMixerCyan: 60,
    monoMixerBlue: 20,
    monoMixerViolet: 0,
    monoMixerMagenta: 80,

    // Auto-fusion "Lumière tamisée" + courbe de contraste
    softLightIntensity: 0,
    contrastCurveIntensity: 0,

    // Dodge & Burn ciblé blancs/noirs
    dodgeBurnWhite: 0,
    dodgeBurnBlack: 0,

    // Gomme locale : réduit l'effet d'UN réglage ciblé, localement, tout en
    // restant N&B partout (contrairement à l'ancienne "Gomme couleur", qui
    // révélait la couleur d'origine — entièrement retirée). Une géométrie de
    // pinceau ET une intensité INDÉPENDANTES par cible : les 8 canaux du
    // mixeur, plus Dodge & Burn, plus Punch (Lumière tamisée + courbe de
    // contraste, réduites ensemble). Voir ImageProcessor._injectMonoLocalMultipliers.
    monoEraseMasks: makeDefaultEraseMasks()
};

// 🔹 Clone profond (pas un simple spread) : les entrées de monoEraseMasks
// sont des objets imbriqués — un spread superficiel partagerait ces MÊMES
// références entre toutes les photos, et startEraseStroke()/appendErasePoint()
// (qui mutent geometry.strokes en place) corromprait alors silencieusement
// la valeur par défaut pour toutes les photos suivantes.
let settings = structuredClone(DEFAULT_SETTINGS);

const MAX_HISTORY = 50;
let historyStack = [];
let redoStack = [];

function beginAction() {
    historyStack.push(JSON.parse(JSON.stringify(settings)));
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    redoStack = [];
}

function undo() {
    if (historyStack.length === 0) return false;
    redoStack.push(JSON.parse(JSON.stringify(settings)));
    settings = historyStack.pop();
    return true;
}

function redo() {
    if (redoStack.length === 0) return false;
    historyStack.push(JSON.parse(JSON.stringify(settings)));
    settings = redoStack.pop();
    return true;
}

function canUndo() { return historyStack.length > 0; }
function canRedo() { return redoStack.length > 0; }

function getSettings() { return settings; }

/**
 * Modifie un ou plusieurs réglages (curseur en direct) sans passer par
 * l'historique — l'appelant (monochromePanel.js) appelle beginAction() au
 * mousedown, comme masksPanel.js le fait pour ses propres curseurs.
 */
function updateSettings(partial) {
    settings = { ...settings, ...partial };
    return settings;
}

/**
 * Remplace tous les réglages (chargement d'une photo) sans passer par
 * l'historique, qui repart de zéro pour la nouvelle photo — même principe
 * que RetouchManager.loadRetouches().
 */
function loadSettings(saved) {
    // structuredClone ici aussi : évite de partager monoEraseMasks (ou tout
    // autre champ imbriqué) avec l'objet "saved" fourni par l'appelant, ou
    // avec DEFAULT_SETTINGS quand "saved" ne couvre pas ce champ.
    settings = structuredClone({ ...DEFAULT_SETTINGS, ...(saved || {}) });
    historyStack = [];
    redoStack = [];
}

/**
 * Réinitialise aux valeurs par défaut (bouton "Réinitialiser"), via
 * l'historique pour rester annulable.
 */
function resetSettings() {
    beginAction();
    settings = structuredClone(DEFAULT_SETTINGS);
    return settings;
}

/**
 * Entrée {geometry, intensity} d'une cible de la Gomme locale (jamais la
 * référence de DEFAULT_SETTINGS — voir le commentaire sur structuredClone
 * plus haut). Cible inconnue : ignorée silencieusement (retourne une entrée
 * vide jetable) plutôt que de planter sur un nom de cible invalide.
 */
function _ensureEraseTarget(target) {
    if (!ERASE_TARGETS.includes(target)) {
        return { geometry: { strokes: [] }, intensity: 100 };
    }
    if (!settings.monoEraseMasks) settings.monoEraseMasks = makeDefaultEraseMasks();
    if (!settings.monoEraseMasks[target]) {
        settings.monoEraseMasks[target] = { geometry: { strokes: [] }, intensity: 100 };
    }
    const entry = settings.monoEraseMasks[target];
    if (!entry.geometry || !Array.isArray(entry.geometry.strokes)) {
        entry.geometry = { strokes: [] };
    }
    return entry;
}

/**
 * Géométrie de pinceau de la cible donnée (l'un des 10 ERASE_TARGETS).
 */
function getEraseGeometry(target) {
    return _ensureEraseTarget(target).geometry;
}

/**
 * Intensité de la Gomme locale pour la cible donnée (0-100).
 */
function getEraseIntensity(target) {
    return _ensureEraseTarget(target).intensity ?? 100;
}

/**
 * Modifie l'intensité de la Gomme locale pour une seule cible — l'appelant
 * (monochromePanel.js) appelle beginAction() au mousedown du curseur, comme
 * pour les autres réglages du module.
 */
function setEraseIntensity(target, value) {
    _ensureEraseTarget(target).intensity = value;
}

/**
 * Démarre un nouveau trait de gomme sur une cible (mousedown) : un seul
 * beginAction() par trait (pas par point), comme MasksManager.createMask()
 * pour le pinceau de masque — tout le glissé jusqu'au relâchement forme UNE
 * seule étape d'annulation. Chaque cible a sa propre liste de traits :
 * peindre sur "red" n'affecte jamais les traits de "blue" ou "dodgeBurn".
 */
function startEraseStroke(target, point) {
    beginAction();
    const geometry = getEraseGeometry(target);
    geometry.strokes.push([point]);
    return geometry;
}

/**
 * Ajoute un point au dernier trait en cours, sur la cible donnée (mousemove
 * pendant le tracé).
 */
function appendErasePoint(target, point) {
    const geometry = getEraseGeometry(target);
    if (!geometry.strokes.length) {
        geometry.strokes.push([point]);
    } else {
        geometry.strokes[geometry.strokes.length - 1].push(point);
    }
    return geometry;
}

/**
 * Efface les traits d'UNE SEULE cible ("Réinitialiser cette cible") — son
 * intensité réglée est conservée, seule la géométrie peinte est vidée.
 * Annulable via l'historique.
 */
function resetEraseMask(target) {
    if (!ERASE_TARGETS.includes(target)) return;
    beginAction();
    const entry = _ensureEraseTarget(target);
    entry.geometry = { strokes: [] };
}

/**
 * Efface TOUTES les cibles ("Tout réinitialiser") : géométrie ET intensité
 * repartent à zéro pour les 10 cibles. Annulable via l'historique.
 */
function resetAllEraseMasks() {
    beginAction();
    settings.monoEraseMasks = makeDefaultEraseMasks();
}

if (typeof window !== "undefined") {
    window.MonochromeManager = {
        getSettings,
        updateSettings,
        loadSettings,
        resetSettings,
        beginAction,
        undo,
        redo,
        canUndo,
        canRedo,
        getEraseGeometry,
        getEraseIntensity,
        setEraseIntensity,
        startEraseStroke,
        appendErasePoint,
        resetEraseMask,
        resetAllEraseMasks,
        ERASE_TARGETS,
        DEFAULT_SETTINGS
    };
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        getSettings, updateSettings, loadSettings, resetSettings,
        beginAction, undo, redo, canUndo, canRedo,
        getEraseGeometry, getEraseIntensity, setEraseIntensity,
        startEraseStroke, appendErasePoint, resetEraseMask, resetAllEraseMasks,
        ERASE_TARGETS, DEFAULT_SETTINGS
    };
}

})();
