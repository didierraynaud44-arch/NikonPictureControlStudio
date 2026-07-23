const fs = require("fs");
const exifr = require("exifr");
const path = require("path");


async function readNEF(filePath) {

    const buffer = fs.readFileSync(filePath);

    const exif = await exifr.parse(buffer, {
        tiff: true,
        exif: true,
        makerNote: true
    });


    return {

        path: filePath,

        fileName: path.basename(filePath),

        make: exif?.Make || "",

        model: exif?.Model || "",

        lens: exif?.LensModel || "",

        iso: exif?.ISO || "",

        aperture: exif?.FNumber || "",

        shutter: exif?.ExposureTime || "",

        focal: exif?.FocalLength || "",

        date: exif?.DateTimeOriginal || ""

    };

}


module.exports = {
    readNEF
};