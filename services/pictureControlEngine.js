let currentPictureControl = null;
let originalPictureControl = null;


/**
 * Charge un Picture Control
 */
function load(pc) {

    originalPictureControl = structuredClone(pc);

    currentPictureControl = structuredClone(pc);

}


/**
 * Retourne le Picture Control courant
 */
function get() {

    return currentPictureControl;

}


/**
 * Retourne l'original
 */
function getOriginal() {

    return originalPictureControl;

}


/**
 * Modifie une valeur
 */
function update(property, value) {

    if (!currentPictureControl)
        return null;

    currentPictureControl[property] = value;

    return currentPictureControl;

}

/**
 * Remise à zéro
 */

function reset() {

    if (!originalPictureControl)
        return null;

    currentPictureControl = structuredClone(originalPictureControl);

    return currentPictureControl;

}

/**
 * Vérifie si un Picture Control est chargé
 */
function isLoaded() {

    return currentPictureControl !== null;

}


module.exports = {

    load,

    get,

    getOriginal,

    update,

    reset,

    isLoaded

};