console.log("Nikon Picture Control Studio");

//==============================
// Bouton Ouvrir NEF
//==============================

const button = document.getElementById("openNef");

button.addEventListener("click", async () => {

    console.log("Bouton NEF");

    const info = await window.electronAPI.openNEF();

    if (!info)
        return;

    updateExif(info);

    updatePreview(info);

    updatePictureControl(info);

});


//==============================
// Bouton Import NP3
//==============================

const np3Button = document.getElementById("openNP3");

np3Button.addEventListener("click", async () => {

    console.log("Import NP3");

    const pc = await window.electronAPI.loadNP3();

    if (!pc)
        return;

    console.log(pc);

    updatePictureControl({
        pictureControl: pc
    });

});