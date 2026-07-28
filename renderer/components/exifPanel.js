function updateExif(info) {
    const exifContainer = document.getElementById("exifInfo");
    if (!exifContainer) return;

    if (!info) {
        exifContainer.innerHTML = "<h3>Informations NEF</h3><p>Aucun fichier chargé.</p>";
        return;
    }

    const fmtClicks = (v) => typeof v === "number" ? `${v.toLocaleString("fr-FR")} clics` : v;

    exifContainer.innerHTML = `
        <h3>Informations NEF</h3>
        <p><b>Fichier :</b> ${info.fileName || "Inconnu"}</p>
        <p><b>Appareil :</b> ${info.make || ""} ${info.model || "Inconnu"}</p>
        <p><b>Objectif :</b> ${info.lens || "Non renseigné"}</p>
        <p><b>Artiste :</b> ${info.artist || "Non renseigné"}</p>
        <p><b>Déclenchements :</b> 📸 <strong>${fmtClicks(info.shutterCount)}</strong></p>

        <hr style="border:0; border-top: 1px solid #444; margin: 10px 0;">

        <p><b>Exposition :</b> ${info.exposureProgram}</p>
        <p><b>Correction d'expo :</b> ${info.exposureCompensation}</p>

        <hr style="border:0; border-top: 1px solid #444; margin: 10px 0;">

        <p><b>Focale :</b> ${info.focal}</p>
        <p><b>Ouverture :</b> ${info.aperture}</p>
        <p><b>Vitesse :</b> ${info.shutter}</p>
        <p><b>ISO :</b> ${info.iso}</p>
    `;
}

window.updateExif = updateExif;