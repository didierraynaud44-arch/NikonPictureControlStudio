function updateExif(info) {
    const exifContainer = document.getElementById("exifInfo");

    if (!exifContainer) return;

    if (!info) {
        exifContainer.innerHTML = "<h3>Informations NEF</h3><p>Aucun fichier chargé.</p>";
        return;
    }

    // Formateurs de sécurité
    const fmtAperture = (v) => v ? (String(v).startsWith("f/") ? v : `f/${v}`) : "N/C";
    const fmtShutter  = (v) => v ? (String(v).endsWith("s") ? v : `${v}s`) : "N/C";
    const fmtFocal    = (v) => v ? (String(v).endsWith("mm") ? v : `${v}mm`) : "N/C";

    exifContainer.innerHTML = `
        <h3>Informations NEF</h3>
        <p><b>Fichier :</b> ${info.fileName || "Inconnu"}</p>
        <p><b>Appareil :</b> ${info.make || ""} ${info.model || "Inconnu"}</p>
        <p><b>Objectif :</b> ${info.lens || "Non renseigné"}</p>
        <hr style="border:0; border-top: 1px solid #444; margin: 10px 0;">
        <p><b>ISO :</b> ${info.iso || "N/C"}</p>
        <p><b>Ouverture :</b> ${fmtAperture(info.aperture)}</p>
        <p><b>Vitesse :</b> ${fmtShutter(info.shutter)}</p>
        <p><b>Focale :</b> ${fmtFocal(info.focal)}</p>
    `;
}

window.updateExif = updateExif;