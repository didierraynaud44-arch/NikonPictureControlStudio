/*=========================================================
    Pixel RAW - Neural Denoise Engine
    Orchestrateur du débruitage neuronal (NAFNet) : découpe une image en
    tuiles 768x768 avec recouvrement, délègue chaque tuile au Worker dédié
    (voir neuralDenoiseWorker.js, qui garde la session onnxruntime-web en
    mémoire), puis réassemble le résultat avec un fondu (feather) sur les
    zones de recouvrement pour éviter toute jointure visible.

    Un seul Worker créé au premier appel, réutilisé ensuite (même principe
    que le cache de session dans AIMaskEngine.js). Les tuiles sont traitées
    SÉQUENTIELLEMENT (une seule à la fois), quel que soit le moteur retenu
    (voir neuralDenoiseWorker.js, WebGPU en priorité avec repli WASM) — ça
    simplifie l'annulation (au plus une tuile "en vol" à la fois, voir
    denoiseImage ci-dessous) sans rien coûter en pratique : les deux backends
    traitent de toute façon les tuiles l'une après l'autre en interne.
=========================================================*/

(function () {

const TILE_SIZE = 768;
const OVERLAP = 64;
const STRIDE = TILE_SIZE - OVERLAP;

let worker = null;
let messageId = 0;
const pending = new Map();
let lastLoggedProvider = null; // dernier moteur (webgpu/wasm) confirmé par le worker, pour ne logger qu'un changement

function getWorker() {
    if (worker) return worker;

    // 🔹 Chemin relatif classique (pas import.meta.url : ce fichier est un
    // script normal, pas un module) — résolu par rapport à index.html,
    // comme tous les <script src="core/..."> déjà en place.
    worker = new Worker("core/neuralDenoiseWorker.js", { type: "module" });

    worker.onmessage = (event) => {
        const msg = event.data;
        if (!msg || msg.id === undefined) return;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);

        if (msg.type === "tileResult") {
            // 🔹 Log côté thread principal EN PLUS de celui du worker (voir
            // onnxProviderHelper.js) : visible à coup sûr dans la console du
            // renderer, sans dépendre de la façon dont DevTools bascule sur le
            // contexte console d'un Worker. Re-logué si le moteur change en
            // cours de job (repli WebGPU -> WASM à mi-chemin, voir
            // neuralDenoiseWorker.js/forceFallbackToWasm).
            if (msg.provider && msg.provider !== lastLoggedProvider) {
                lastLoggedProvider = msg.provider;
                console.log(`🖥️ Débruitage neuronal : moteur d'inférence actif = ${msg.provider}`);
            }
            entry.resolve(msg.result);
        } else {
            entry.reject(new Error(msg.message || "Erreur inconnue du worker de débruitage neuronal"));
        }
    };

    worker.onerror = (err) => {
        console.error("❌ Erreur fatale du worker de débruitage neuronal :", err);
        for (const entry of pending.values()) entry.reject(err);
        pending.clear();
    };

    return worker;
}

function runTile(tileFloatArray) {
    return new Promise((resolve, reject) => {
        const id = ++messageId;
        pending.set(id, { resolve, reject });
        getWorker().postMessage({ type: "denoiseTile", id, tile: tileFloatArray }, [tileFloatArray.buffer]);
    });
}

/**
 * Origines de tuiles sur UN axe (largeur ou hauteur), espacées de STRIDE,
 * la dernière toujours calée pile sur le bord (dim - TILE_SIZE) même si ça
 * chevauche un peu plus que STRIDE avec la précédente — garantit une
 * couverture complète sans jamais dépasser l'image. Si l'image est plus
 * petite que TILE_SIZE sur cet axe (cas marginal, aperçu réduit), une seule
 * origine à 0 : voir reflectIndex() pour le remplissage par effet miroir.
 */
function computeAxisOrigins(dim) {
    if (dim <= TILE_SIZE) return [0];

    const origins = [];
    let pos = 0;
    while (pos + TILE_SIZE < dim) {
        origins.push(pos);
        pos += STRIDE;
    }
    const last = dim - TILE_SIZE;
    if (origins[origins.length - 1] !== last) origins.push(last);
    return origins;
}

function computeTileOrigins(width, height) {
    const xs = computeAxisOrigins(width);
    const ys = computeAxisOrigins(height);
    const origins = [];
    for (const y0 of ys) {
        for (const x0 of xs) origins.push({ x0, y0 });
    }
    return origins;
}

/**
 * Repli par effet miroir (sans le bord dupliqué) pour un indice hors bornes
 * — ne sert en pratique que pour le cas marginal dim < TILE_SIZE (voir
 * computeAxisOrigins) ; pour toutes les tuiles normales, i reste toujours
 * dans [0, dim) et cette fonction est l'identité.
 */
function reflectIndex(i, dim) {
    if (dim <= 1) return 0;
    const period = 2 * dim - 2;
    let m = ((i % period) + period) % period;
    if (m >= dim) m = period - m;
    return m;
}

/**
 * Extrait une tuile TILE_SIZE x TILE_SIZE en tenseur planaire NCHW
 * [1,3,768,768], normalisé [0,255] -> [0,1] (NAFNet attend du RGB brut,
 * sans normalisation ImageNet — voir model.yaml de darktable-ai).
 */
function extractTileTensor(data, width, height, x0, y0) {
    const tensor = new Float32Array(3 * TILE_SIZE * TILE_SIZE);
    const plane = TILE_SIZE * TILE_SIZE;

    for (let ty = 0; ty < TILE_SIZE; ty++) {
        const sy = reflectIndex(y0 + ty, height);
        const rowDst = ty * TILE_SIZE;
        for (let tx = 0; tx < TILE_SIZE; tx++) {
            const sx = reflectIndex(x0 + tx, width);
            const srcIdx = (sy * width + sx) * 4;
            const dstIdx = rowDst + tx;

            tensor[dstIdx]              = data[srcIdx] / 255;
            tensor[plane + dstIdx]      = data[srcIdx + 1] / 255;
            tensor[2 * plane + dstIdx]  = data[srcIdx + 2] / 255;
        }
    }

    return tensor;
}

/**
 * Poids de fondu 1D : rampe de 1/OVERLAP (jamais 0, pour ne jamais diviser
 * par zéro sur le pixel le plus au bord d'une tuile isolée) jusqu'à 1 sur
 * les OVERLAP premiers/derniers pixels, plat à 1 au centre. Le poids 2D est
 * le produit des poids en x et y (fondu séparable classique). Une tuile de
 * bord d'image (sans voisine de ce côté) obtient quand même une
 * normalisation correcte : si un seul poids contribue à un pixel donné, la
 * division somme/poids redonne exactement sa valeur, quelle que soit la
 * forme du poids.
 */
function featherWeight1D(t, size, overlap) {
    const rise = Math.min(1, (t + 1) / overlap);
    const fall = Math.min(1, (size - t) / overlap);
    return Math.min(rise, fall);
}

function accumulateTile(sumBuffer, weightBuffer, resultFlat, imgWidth, imgHeight, x0, y0) {
    const plane = TILE_SIZE * TILE_SIZE;

    for (let ty = 0; ty < TILE_SIZE; ty++) {
        const dy = y0 + ty;
        if (dy < 0 || dy >= imgHeight) continue;
        const wy = featherWeight1D(ty, TILE_SIZE, OVERLAP);
        const rowSrc = ty * TILE_SIZE;

        for (let tx = 0; tx < TILE_SIZE; tx++) {
            const dx = x0 + tx;
            if (dx < 0 || dx >= imgWidth) continue;
            const w = featherWeight1D(tx, TILE_SIZE, OVERLAP) * wy;

            const srcIdx = rowSrc + tx;
            const dstPixel = dy * imgWidth + dx;
            const dstBase = dstPixel * 3;

            sumBuffer[dstBase]     += resultFlat[srcIdx] * w;
            sumBuffer[dstBase + 1] += resultFlat[plane + srcIdx] * w;
            sumBuffer[dstBase + 2] += resultFlat[2 * plane + srcIdx] * w;
            weightBuffer[dstPixel] += w;
        }
    }
}

function buildImageDataFromAccum(sumBuffer, weightBuffer, width, height, alphaSource) {
    const out = new Uint8ClampedArray(width * height * 4);

    for (let p = 0; p < width * height; p++) {
        const w = weightBuffer[p] || 1e-6;
        const base3 = p * 3;
        const base4 = p * 4;

        out[base4]     = Math.round(Math.min(1, Math.max(0, sumBuffer[base3] / w)) * 255);
        out[base4 + 1] = Math.round(Math.min(1, Math.max(0, sumBuffer[base3 + 1] / w)) * 255);
        out[base4 + 2] = Math.round(Math.min(1, Math.max(0, sumBuffer[base3 + 2] / w)) * 255);
        out[base4 + 3] = alphaSource[base4 + 3];
    }

    return new ImageData(out, width, height);
}

/**
 * Débruite imageData (ImageData RGBA pleine résolution) en le découpant en
 * tuiles TILE_SIZE x TILE_SIZE avec recouvrement OVERLAP, traitées une par
 * une par le Worker dédié, puis réassemblées avec fondu.
 *
 * @param {ImageData} imageData
 * @param {{onProgress?: (done:number, total:number) => void, signal?: {cancelled:boolean}}} [options]
 * @returns {Promise<ImageData>}
 */
async function denoiseImage(imageData, options = {}) {
    const { onProgress, signal } = options;
    const { width, height, data } = imageData;

    lastLoggedProvider = null; // 🔹 nouveau job : reconfirmer le moteur même s'il est identique au précédent

    const tiles = computeTileOrigins(width, height);
    const sumBuffer = new Float32Array(width * height * 3);
    const weightBuffer = new Float32Array(width * height);

    let done = 0;
    for (const { x0, y0 } of tiles) {
        if (signal && signal.cancelled) break;

        const tileInput = extractTileTensor(data, width, height, x0, y0);
        const resultFlat = await runTile(tileInput);

        // 🔹 Annulé PENDANT l'inférence de cette tuile : le résultat est jeté
        // (pas de tuile "à moitié" possible côté Worker, donc rien d'autre à défaire).
        if (signal && signal.cancelled) break;

        accumulateTile(sumBuffer, weightBuffer, resultFlat, width, height, x0, y0);
        done++;
        if (typeof onProgress === "function") onProgress(done, tiles.length);
    }

    if (signal && signal.cancelled) {
        const err = new Error("Débruitage neuronal annulé");
        err.cancelled = true;
        throw err;
    }

    return buildImageDataFromAccum(sumBuffer, weightBuffer, width, height, data);
}

if (typeof window !== "undefined") {
    window.NeuralDenoiseEngine = {
        denoiseImage,
        TILE_SIZE,
        OVERLAP
    };
}

})();
