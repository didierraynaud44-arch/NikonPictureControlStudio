/*=========================================================
    Nikon Picture Control Studio - Décodeur RAW pleine résolution

    Ce module tourne dans le renderer (contexte Chromium) et pas dans le
    process main : libraw-wasm démarre un Worker DOM pour décoder, une API
    absente du contexte Node du process main Electron. C'est pourquoi ce
    fichier est chargé en <script type="module"> (voir index.html) plutôt
    qu'utilisé côté main.js.
=========================================================*/

import LibRaw from "../../node_modules/libraw-wasm/dist/index.js";

/**
 * Convertit les pixels décodés par libraw-wasm (RGB ou RGBA selon `colors`)
 * en RGBA, format requis par l'API Canvas ImageData.
 */
function toRGBA({ width, height, data, colors }) {
    if (colors === 4) {
        return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
    }

    if (colors === 3) {
        const pixelCount = width * height;
        const rgba = new Uint8ClampedArray(pixelCount * 4);
        for (let i = 0, srcOffset = 0, dstOffset = 0; i < pixelCount; i++, srcOffset += 3, dstOffset += 4) {
            rgba[dstOffset]     = data[srcOffset];
            rgba[dstOffset + 1] = data[srcOffset + 1];
            rgba[dstOffset + 2] = data[srcOffset + 2];
            rgba[dstOffset + 3] = 255;
        }
        return rgba;
    }

    throw new Error(`Nombre de canaux non pris en charge : ${colors}`);
}

/**
 * Démosaïque un fichier RAW à sa résolution capteur native via libraw-wasm.
 * @param {Uint8Array} bytes - Octets bruts du fichier RAW
 * @returns {Promise<{width:number, height:number, data:Uint8ClampedArray}|null>}
 */
async function decodeRawFullResolution(bytes) {
    const raw = new LibRaw();
    const timerLabel = "⏱️ libraw-wasm : décodage RAW pleine résolution";
    console.time(timerLabel);

    try {
        const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

        await raw.open(input, {
            userFlip: -1,   // respecte l'orientation embarquée dans le RAW
            outputColor: 1, // sRGB
            outputBps: 8
        });

        const imageData = await raw.imageData();
        if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
            throw new Error("Aucune donnée image retournée par libraw-wasm");
        }

        const rgba = toRGBA(imageData);
        console.timeEnd(timerLabel);
        console.log(`✅ RAW décodé pleine résolution : ${imageData.width}x${imageData.height}`);

        return { width: imageData.width, height: imageData.height, data: rgba };

    } catch (err) {
        console.timeEnd(timerLabel);
        console.error("❌ Échec décodage RAW pleine résolution :", err.message);
        return null;

    } finally {
        if (typeof raw.dispose === "function") raw.dispose();
    }
}

window.decodeRawFullResolution = decodeRawFullResolution;
