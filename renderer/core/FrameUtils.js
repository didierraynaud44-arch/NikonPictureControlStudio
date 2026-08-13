/*=========================================================
    Pixel RAW - Encadrement (frame utilitaire partagé)
    Utilisé à la fois par l'export (ImageProcessor.exportFullResolution)
    et par l'impression (PrintManager, via le même appel), pour que
    l'aperçu et le résultat réel affichent toujours le même cadre.
=========================================================*/

/**
 * Ajoute un encadrement uni (blanc ou noir) autour de l'image, en AGRANDISSANT
 * le canevas — ne recadre jamais dans la photo, aucun pixel n'est perdu.
 * @param {ImageData} imageData
 * @param {{enabled:boolean, color:'white'|'black', widthPercent:number}} options
 * @returns {ImageData} l'image encadrée (nouvelle instance, plus grande), ou
 *          imageData inchangée si le cadre est désactivé/de largeur nulle.
 */
function applyFrame(imageData, options) {
    if (!imageData || !options || !options.enabled) return imageData;

    const widthPercent = Math.max(0, Math.min(15, options.widthPercent ?? 0));
    if (widthPercent <= 0) return imageData;

    const borderPx = Math.round((widthPercent / 100) * Math.min(imageData.width, imageData.height));
    if (borderPx <= 0) return imageData;

    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = imageData.width;
    srcCanvas.height = imageData.height;
    srcCanvas.getContext("2d").putImageData(imageData, 0, 0);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = imageData.width + borderPx * 2;
    outCanvas.height = imageData.height + borderPx * 2;
    const outCtx = outCanvas.getContext("2d");

    outCtx.fillStyle = options.color === "black" ? "#000000" : "#ffffff";
    outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
    // Photo centrée, dessinée à sa taille d'origine : aucun pixel rogné.
    outCtx.drawImage(srcCanvas, borderPx, borderPx);

    return outCtx.getImageData(0, 0, outCanvas.width, outCanvas.height);
}

if (typeof window !== "undefined") {
    window.applyFrame = applyFrame;
}
