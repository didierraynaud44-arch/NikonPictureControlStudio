function updatePreview(info) {

    const image = document.getElementById("previewImage");

    if (info.preview) {

        image.src = info.preview;

    } else {

        image.removeAttribute("src");

        image.alt = "Aucun aperçu";

    }

}

window.updatePreview = updatePreview;