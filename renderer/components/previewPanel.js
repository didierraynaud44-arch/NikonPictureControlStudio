async function updatePreview(info) {

    if (!info.preview)
        return;

    await window.imageProcessor.load(info.preview);

}

window.updatePreview = updatePreview;