const fs = require("fs");

const {
    deserialize,
    serialize
} = require("nikon-flexible-color-picture-control");


function loadNP3(filePath) {

    const buffer = fs.readFileSync(filePath);

    const pc = deserialize(buffer);

    console.log("===== NP3 chargé =====");
    console.log(pc);

    return pc;
}


function saveNP3(filePath, pictureControl) {

    const buffer = serialize(pictureControl);

    fs.writeFileSync(filePath, buffer);

    console.log("NP3 enregistré :", filePath);

}


function setSharpness(pc, value) {

    pc.sharpning = value;

}

function setContrast(pc, value) {

    pc.contrast = value;

}

function setHighlights(pc, value) {

    pc.highlights = value;

}

function setSaturation(pc, value) {

    pc.saturation = value;

}

module.exports = {

    loadNP3,
    saveNP3,
    setSharpness,
    setContrast,
    setHighlights,
    setSaturation

};