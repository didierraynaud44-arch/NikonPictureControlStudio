/*=========================================================
    Nikon Picture Control Studio - Masks Manager
=========================================================*/

(function () {

let masksList = [];
let activeMaskId = null;
let maskIdCounter = 0;

const MAX_HISTORY = 50;
let historyStack = [];
let redoStack = [];

function beginAction() {
    historyStack.push(JSON.parse(JSON.stringify(masksList)));
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    redoStack = [];
}

function undo() {
    if (historyStack.length === 0) return false;
    redoStack.push(JSON.parse(JSON.stringify(masksList)));
    masksList = historyStack.pop();
    if (!masksList.find(m => m.id === activeMaskId)) {
        activeMaskId = masksList.length ? masksList[masksList.length - 1].id : null;
    }
    return true;
}

function redo() {
    if (redoStack.length === 0) return false;
    historyStack.push(JSON.parse(JSON.stringify(masksList)));
    masksList = redoStack.pop();
    if (!masksList.find(m => m.id === activeMaskId)) {
        activeMaskId = masksList.length ? masksList[masksList.length - 1].id : null;
    }
    return true;
}

function canUndo() { return historyStack.length > 0; }
function canRedo() { return redoStack.length > 0; }

const DEFAULT_MASK_ADJUSTMENTS = {
    exposure: 0, blackPoint: 0, whitePoint: 255,
    sharpening: 0, midRangeSharpening: 0, clarity: 0,
    contrast: 0, brightness: 0, saturation: 0, hue: 0,
    highlights: 0, shadows: 0, dehaze: 0, vibrance: 0,
    vignette: 0, denoise: 0
};

function createMask(type, geometry) {
    beginAction();
    maskIdCounter += 1;

    const initialAdjustments = { ...DEFAULT_MASK_ADJUSTMENTS };

    const mask = {
        id: `mask_${Date.now()}_${maskIdCounter}`,
        type,
        name: null,
        enabled: true,
        opacity: 1,
        geometry,
        adjustments: initialAdjustments
    };
    masksList.push(mask);
    activeMaskId = mask.id;
    return mask;
}

function getMasks() { return masksList; }
function getMask(id) { return masksList.find(m => m.id === id) || null; }
function getActiveMask() { return getMask(activeMaskId); }
function setActiveMask(id) { activeMaskId = id; }

function updateMaskGeometry(id, geometry) {
    const mask = getMask(id);
    if (mask) mask.geometry = { ...mask.geometry, ...geometry };
    return mask;
}

function updateMaskAdjustments(id, adjustments) {
    const mask = getMask(id);
    if (mask) mask.adjustments = { ...mask.adjustments, ...adjustments };
    return mask;
}

function toggleMask(id) {
    const mask = getMask(id);
    if (mask) {
        beginAction();
        mask.enabled = !mask.enabled;
    }
    return mask;
}

function removeMask(id) {
    beginAction();
    masksList = masksList.filter(m => m.id !== id);
    if (activeMaskId === id) {
        activeMaskId = masksList.length ? masksList[masksList.length - 1].id : null;
    }
}

function clearMasks() {
    masksList = [];
    activeMaskId = null;
}

function updateMaskOpacity(id, opacity) {
    const mask = getMask(id);
    if (mask) mask.opacity = opacity;
    return mask;
}

function displayName(mask) {
    if (mask.name) return mask.name;
    const labels = { linear: "Linéaire", radial: "Radial", brush: "Pinceau" };
    const sameType = masksList.filter(m => m.type === mask.type);
    const index = sameType.indexOf(mask) + 1;
    return `${labels[mask.type] || mask.type} ${index}`;
}

if (typeof window !== "undefined") {
    window.MasksManager = {
        createMask,
        getMasks,
        getMask,
        getActiveMask,
        setActiveMask,
        updateMaskGeometry,
        updateMaskAdjustments,
        updateMaskOpacity,
        toggleMask,
        removeMask,
        clearMasks,
        displayName,
        beginAction,
        undo,
        redo,
        canUndo,
        canRedo,
        DEFAULT_MASK_ADJUSTMENTS
    };
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        createMask, getMasks, getMask, getActiveMask, setActiveMask,
        updateMaskGeometry, updateMaskAdjustments, updateMaskOpacity, toggleMask, removeMask,
        clearMasks, displayName, beginAction, undo, redo, canUndo, canRedo, DEFAULT_MASK_ADJUSTMENTS
    };
}

})();
