console.log("Nikon Picture Control Studio");


const button = document.getElementById("openNef");

console.log("Bouton trouvé :", button);


button.addEventListener("click", async () => {

    console.log("Bouton NEF cliqué");


    const info = await window.electronAPI.openNEF();


    console.log("Retour NEF :", info);


    if (info) {

        document.getElementById("status").innerHTML = `

        <h2>Informations NEF</h2>

        <p><b>Fichier :</b> ${info.fileName}</p>

        <p><b>Appareil :</b> ${info.make} ${info.model}</p>

        <p><b>Objectif :</b> ${info.lens}</p>

        <p><b>ISO :</b> ${info.iso}</p>

        <p><b>Ouverture :</b> ${info.aperture}</p>

        <p><b>Vitesse :</b> ${info.shutter}</p>

        <p><b>Focale :</b> ${info.focal}</p>

        `;
const image = document.getElementById("previewImage");

if (info.preview) {
    image.src = info.preview;
}
    }

});