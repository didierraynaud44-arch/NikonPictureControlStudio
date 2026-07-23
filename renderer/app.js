console.log("Nikon Picture Control Studio");

const button = document.getElementById("openNef");

console.log("Bouton trouvé :", button);

button.addEventListener("click", async () => {

    console.log("Bouton NEF cliqué");

    const info = await window.electronAPI.openNEF();

    console.log("Retour NEF :", JSON.stringify(info, null, 2));

    if (!info) {
        return;
    }

    // Mise à jour des différents panneaux
    updateExif(info);

    updatePreview(info);

    updatePictureControl(info);

});