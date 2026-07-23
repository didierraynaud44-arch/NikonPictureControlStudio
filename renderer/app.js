console.log("Nikon Picture Control Studio");


const button = document.getElementById("openNef");

console.log("Bouton trouvé :", button);


button.addEventListener("click", async () => {

    console.log("Bouton NEF cliqué");


    const info = await window.electronAPI.openNEF();



console.log("Retour NEF :", JSON.stringify(info, null, 2));

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
} else {
    image.removeAttribute("src");
    image.alt = "Aucun aperçu disponible";
}

const pc = document.getElementById("pictureControlStatus");

if (info.pictureControl) {

    pc.innerHTML = `

<p><b>Nom :</b> ${info.pictureControl.name}</p>

<p><b>Netteté :</b> ${info.pictureControl.sharpness}</p>

<p><b>Contraste :</b> ${info.pictureControl.contrast}</p>

<p><b>Luminosité :</b> ${info.pictureControl.brightness}</p>

<p><b>Saturation :</b> ${info.pictureControl.saturation}</p>

<p><b>Teinte :</b> ${info.pictureControl.hue || "-"}</p>

`;

} else {

    pc.innerHTML = "Aucun Picture Control détecté.";

}
}

});