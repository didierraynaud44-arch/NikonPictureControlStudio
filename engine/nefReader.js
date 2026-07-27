const fs = require("fs");
const exifr = require("exifr");
const path = require("path");

async function readNEF(filePath) {
    try {
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
            aperture: exif?.FNumber ? `f/${exif.FNumber}` : "",
            shutter: exif?.ExposureTime ? (exif.ExposureTime < 1 ? `1/${Math.round(1 / exif.ExposureTime)}` : `${exif.ExposureTime}s`) : "",
            focal: exif?.FocalLength ? `${exif.FocalLength}mm` : "",
            date: exif?.DateTimeOriginal || ""
        };
    } catch (error) {
        console.error("Erreur lors de la lecture des EXIF avec exifr :", error);
        
        // Fallback minimal en cas d'erreur de parsing EXIF
        return {
            path: filePath,
            fileName: path.basename(filePath),
            make: "Inconnu",
            model: "Inconnu",
            lens: "",
            iso: "",
            aperture: "",
            shutter: "",
            focal: "",
            date: ""
        };
    }
}

module.exports = {
    readNEF
};