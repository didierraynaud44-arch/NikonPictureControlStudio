/*=========================================================
    Pixel RAW - Retouch Manager
    Liste des opérations de retouche (tampon de duplication), distincte
    des masques locaux : ce ne sont pas des réglages ajustables en direct
    mais des corrections appliquées une fois, en amont du pipeline.
=========================================================*/

(function () {

let retouchList = [];
let retouchIdCounter = 0;

// Incrémenté à chaque changement de la liste : sert de clé de cache légère
// pour ImageProcessor (évite de refaire la fusion de Poisson à chaque frame
// si aucune retouche n'a changé).
let retouchVersion = 0;

const MAX_HISTORY = 50;
let historyStack = [];
let redoStack = [];

function beginAction() {
    historyStack.push(JSON.parse(JSON.stringify(retouchList)));
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    redoStack = [];
}

function undo() {
    if (historyStack.length === 0) return false;
    redoStack.push(JSON.parse(JSON.stringify(retouchList)));
    retouchList = historyStack.pop();
    retouchVersion++;
    return true;
}

function redo() {
    if (redoStack.length === 0) return false;
    historyStack.push(JSON.parse(JSON.stringify(retouchList)));
    retouchList = redoStack.pop();
    retouchVersion++;
    return true;
}

function canUndo() { return historyStack.length > 0; }
function canRedo() { return redoStack.length > 0; }

/**
 * @param {'clone'|'heal'} mode
 * @param {{strokes: Array}} destGeometry - même format que les masques pinceau (coords normalisées 0..1)
 * @param {{dx:number, dy:number}} sourceOffset - position de la source relative à la destination (normalisée)
 */
function createRetouch(mode, destGeometry, sourceOffset) {
    beginAction();
    retouchIdCounter += 1;

    const retouch = {
        id: `retouch_${Date.now()}_${retouchIdCounter}`,
        mode,
        destGeometry,
        sourceOffset
    };
    retouchList.push(retouch);
    retouchVersion++;
    return retouch;
}

function getRetouches() { return retouchList; }
function getRetouch(id) { return retouchList.find(r => r.id === id) || null; }

function removeRetouch(id) {
    beginAction();
    retouchList = retouchList.filter(r => r.id !== id);
    retouchVersion++;
}

function clearRetouches() {
    retouchList = [];
    retouchVersion++;
}

/**
 * Remplace toute la liste (chargement d'une photo) sans passer par
 * l'historique undo/redo, qui repart de zéro pour la nouvelle photo.
 */
function loadRetouches(list) {
    retouchList = Array.isArray(list) ? list : [];
    historyStack = [];
    redoStack = [];
    retouchVersion++;
}

function getVersion() { return retouchVersion; }

if (typeof window !== "undefined") {
    window.RetouchManager = {
        createRetouch,
        getRetouches,
        getRetouch,
        removeRetouch,
        clearRetouches,
        loadRetouches,
        getVersion,
        beginAction,
        undo,
        redo,
        canUndo,
        canRedo
    };
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        createRetouch, getRetouches, getRetouch, removeRetouch, clearRetouches,
        loadRetouches, getVersion, beginAction, undo, redo, canUndo, canRedo
    };
}

})();
