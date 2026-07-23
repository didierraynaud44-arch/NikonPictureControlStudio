function updatePictureControl(info) {

    const pc = document.getElementById("pictureControlStatus");

    if (!info.pictureControl) {

        pc.innerHTML = "Aucun Picture Control.";

        return;

    }

    pc.innerHTML = `

        <p><b>Nom :</b> ${info.pictureControl.name}</p>

        <p><b>Netteté :</b> ${info.pictureControl.sharpness}</p>

        <p><b>Contraste :</b> ${info.pictureControl.contrast}</p>

        <p><b>Luminosité :</b> ${info.pictureControl.brightness}</p>

        <p><b>Saturation :</b> ${info.pictureControl.saturation}</p>

        <p><b>Teinte :</b> ${info.pictureControl.hue || "-"}</p>

    `;

}

window.updatePictureControl = updatePictureControl;