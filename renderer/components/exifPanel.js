function updateExif(info) {

    document.getElementById("status").innerHTML = `

        <p><b>Fichier :</b> ${info.fileName}</p>

        <p><b>Appareil :</b> ${info.make} ${info.model}</p>

        <p><b>Objectif :</b> ${info.lens}</p>

        <p><b>ISO :</b> ${info.iso}</p>

        <p><b>Ouverture :</b> f/${info.aperture}</p>

        <p><b>Vitesse :</b> ${info.shutter} s</p>

        <p><b>Focale :</b> ${info.focal} mm</p>

    `;

}

window.updateExif = updateExif;