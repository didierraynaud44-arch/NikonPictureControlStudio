/*=========================================================
    Pixel RAW - Moteur d'inférence IA pour les masques (Ciel / Sujet / Arrière-plan)

    Tourne entièrement dans le RENDERER (comme libraw-wasm, voir
    RawFullResDecoder.js) : onnxruntime-web a besoin d'un contexte Chromium
    (WASM navigateur) absent du process main Electron. Chargé en
    <script type="module"> (voir index.html) pour pouvoir importer ort en ESM,
    exactement comme RawFullResDecoder.js importe libraw-wasm.

    Deux modèles, tous deux chargés PARESSEUSEMENT (jamais au démarrage) et
    mis en cache en session (jamais rechargés deux fois) :
    - Ciel : U-2-Net (skyseg.onnx, 176 Mo, MIT) — xiongzhu666/Sky-Segmentation-
      and-Post-processing via huggingface.co/JianyuanWang/skyseg. Entrée
      320x320, normalisation ImageNet, pas de sigmoid (min-max normalize),
      voir onnx_interence.py du dépôt source.
    - Sujet/Arrière-plan : MobileSAM (encodeur + décodeur séparés, MIT) via
      akbartus/MobileSAM-in-the-Browser (démo onnxruntime-web fonctionnelle
      réelle, pas juste un export brut). SAM2-Hiera-Tiny a été essayé en
      premier (deux exports communautaires indépendants, SharpAI et
      vietanhdev) mais échoue systématiquement à la création de session
      ("[ShapeInferenceError] Mismatch between number of inferred and
      declared dimensions") — incompatibilité structurelle entre le backend
      WASM d'onnxruntime-web et l'architecture d'encodeur Hiera, pas un
      fichier défectueux. MobileSAM (architecture SAM v1/ViT-T) n'a pas ce
      problème et a une démo navigateur prouvée fonctionnelle.
=========================================================*/

import * as ort from "../../node_modules/onnxruntime-web/dist/ort.min.mjs";

// 🔹 Résolu via import.meta.url (relatif à CE module), pas un chemin relatif
// nu : passé tel quel à fetch() (par ort.InferenceSession.create()), un
// chemin relatif nu se résout par rapport à index.html, pas à ce fichier —
// un niveau de trop, échec silencieux ("Failed to fetch") en production.
const MODEL_PATHS = {
    sky: new URL("../../assets/ai-models/skyseg.onnx", import.meta.url).href,
    subjectEncoder: new URL("../../assets/ai-models/mobilesam-encoder.onnx", import.meta.url).href,
    subjectDecoder: new URL("../../assets/ai-models/mobilesam-decoder.onnx", import.meta.url).href
};

const SKY_INPUT_SIZE = 320;
const SUBJECT_INPUT_LONG_SIDE = 1024;
const SUBJECT_MASK_SIZE = 256;

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

let skySession = null;
let skySessionPromise = null;

let subjectEncoderSession = null;
let subjectDecoderSession = null;
let subjectSessionsPromise = null;

// 🔹 Cache d'encodage : clé = référence de l'ImageData source (pas une
// copie/hash), pour permettre plusieurs clics "Sujet" rapides sur la même
// photo sans ré-encoder à chaque fois (seul segmentSubjectAtPoint change).
let cachedEncodingSourceRef = null;
let cachedEncoding = null;

// ---------------------------------------------------------------
// Chargement paresseux des modèles
// ---------------------------------------------------------------

async function loadSkyModel() {
    if (skySession) return skySession;
    if (skySessionPromise) return skySessionPromise;

    skySessionPromise = (async () => {
        console.time("⏱️ AIMaskEngine : chargement modèle Ciel (skyseg.onnx)");
        const session = await ort.InferenceSession.create(MODEL_PATHS.sky, {
            executionProviders: ["wasm"]
        });
        console.timeEnd("⏱️ AIMaskEngine : chargement modèle Ciel (skyseg.onnx)");
        skySession = session;
        return session;
    })();

    return skySessionPromise;
}

async function loadSam2Models() {
    if (subjectEncoderSession && subjectDecoderSession) {
        return { encoder: subjectEncoderSession, decoder: subjectDecoderSession };
    }
    if (subjectSessionsPromise) return subjectSessionsPromise;

    subjectSessionsPromise = (async () => {
        console.time("⏱️ AIMaskEngine : chargement modèles Sujet (MobileSAM encodeur+décodeur)");
        const [encoder, decoder] = await Promise.all([
            ort.InferenceSession.create(MODEL_PATHS.subjectEncoder, { executionProviders: ["wasm"] }),
            ort.InferenceSession.create(MODEL_PATHS.subjectDecoder, { executionProviders: ["wasm"] })
        ]);
        console.timeEnd("⏱️ AIMaskEngine : chargement modèles Sujet (MobileSAM encodeur+décodeur)");
        subjectEncoderSession = encoder;
        subjectDecoderSession = decoder;
        return { encoder, decoder };
    })();

    return subjectSessionsPromise;
}

// ---------------------------------------------------------------
// Utilitaires image <-> tenseur / alpha map
// ---------------------------------------------------------------

function imageDataToCanvas(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    return canvas;
}

/** Redimensionnement DIRECT (étirement, sans conservation du ratio) vers
 * targetSize x targetSize, normalisation ImageNet, tenseur NCHW Float32.
 * Convention u2net standard (voir onnx_interence.py du dépôt source : simple
 * cv.resize, pas de letterbox). */
function preprocessStretch(sourceCanvas, targetSize) {
    const canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(sourceCanvas, 0, 0, targetSize, targetSize);

    const imgData = ctx.getImageData(0, 0, targetSize, targetSize).data;
    const chSize = targetSize * targetSize;
    const data = new Float32Array(3 * chSize);

    for (let p = 0; p < chSize; p++) {
        const i = p * 4;
        data[p]              = (imgData[i]     / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
        data[chSize + p]     = (imgData[i + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
        data[2 * chSize + p] = (imgData[i + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }

    return new ort.Tensor("float32", data, [1, 3, targetSize, targetSize]);
}

/** Redimensionnement AVEC conservation du ratio (grand côté = targetLongSide),
 * SANS complétion/padding (l'encodeur MobileSAM accepte une entrée
 * rectangulaire, contrairement à SAM2 qui exige un carré). Tenseur HWC
 * (largeur×hauteur×3, PAS NCHW), valeurs 0-255 brutes (PAS de normalisation
 * ImageNet) — contrat exact utilisé par la démo fonctionnelle
 * akbartus/MobileSAM-in-the-Browser (js/main.js), à l'inverse de SAM2.
 * Retourne aussi resizedW/resizedH pour repositionner un point cliqué. */
function preprocessSubjectInput(sourceCanvas, targetLongSide) {
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;
    const scale = targetLongSide / Math.max(srcW, srcH);
    const resizedW = Math.round(srcW * scale);
    const resizedH = Math.round(srcH * scale);

    const canvas = document.createElement("canvas");
    canvas.width = resizedW;
    canvas.height = resizedH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(sourceCanvas, 0, 0, srcW, srcH, 0, 0, resizedW, resizedH);

    const imgData = ctx.getImageData(0, 0, resizedW, resizedH).data;
    const data = new Float32Array(resizedH * resizedW * 3);
    for (let p = 0, i = 0; p < resizedW * resizedH; p++, i += 4) {
        const o = p * 3;
        data[o] = imgData[i];
        data[o + 1] = imgData[i + 1];
        data[o + 2] = imgData[i + 2];
    }

    return {
        tensor: new ort.Tensor("float32", data, [resizedH, resizedW, 3]),
        resizedW,
        resizedH
    };
}

function minMaxNormalize(data) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }
    const range = (max - min) || 1e-6;
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = (data[i] - min) / range;
    return out;
}

function alphaToCanvas(alpha, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(width, height);
    for (let p = 0; p < alpha.length; p++) {
        const v = Math.max(0, Math.min(255, Math.round(alpha[p] * 255)));
        const i = p * 4;
        imgData.data[i] = v;
        imgData.data[i + 1] = v;
        imgData.data[i + 2] = v;
        imgData.data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

/** Redimensionnement direct (étirement) d'une alpha map srcW×srcH vers dstW×dstH. */
function resizeAlphaStretch(alpha, srcW, srcH, dstW, dstH) {
    if (srcW === dstW && srcH === dstH) return alpha;
    const srcCanvas = alphaToCanvas(alpha, srcW, srcH);
    const dstCanvas = document.createElement("canvas");
    dstCanvas.width = dstW;
    dstCanvas.height = dstH;
    const ctx = dstCanvas.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0, dstW, dstH);
    const data = ctx.getImageData(0, 0, dstW, dstH).data;
    const out = new Float32Array(dstW * dstH);
    for (let p = 0; p < out.length; p++) out[p] = data[p * 4] / 255;
    return out;
}


// ---------------------------------------------------------------
// API publique
// ---------------------------------------------------------------

/**
 * Segmente le ciel dans imageData (image ACTUELLEMENT affichée, RGBA).
 * @returns {Promise<Float32Array>} carte d'opacité 0..1, largeur×hauteur = imageData
 */
async function segmentSky(imageData) {
    const session = await loadSkyModel();

    console.time("⏱️ AIMaskEngine : inférence Ciel");
    const canvas = imageDataToCanvas(imageData);
    const inputTensor = preprocessStretch(canvas, SKY_INPUT_SIZE);

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const results = await session.run({ [inputName]: inputTensor });
    console.timeEnd("⏱️ AIMaskEngine : inférence Ciel");

    const raw = results[outputName].data;
    const alpha320 = minMaxNormalize(raw);

    return resizeAlphaStretch(alpha320, SKY_INPUT_SIZE, SKY_INPUT_SIZE, imageData.width, imageData.height);
}

/**
 * Segmente le sujet sous le point (x, y) normalisé (0..1) de imageData.
 * Ré-encode l'image seulement si elle a changé depuis le dernier appel
 * (comparaison par référence), pour permettre plusieurs clics rapides.
 * @returns {Promise<Float32Array>} carte d'opacité 0..1, largeur×hauteur = imageData
 */
async function segmentSubjectAtPoint(imageData, x, y) {
    const { encoder, decoder } = await loadSam2Models();

    if (cachedEncodingSourceRef !== imageData) {
        console.time("⏱️ AIMaskEngine : encodage image Sujet (MobileSAM)");
        const canvas = imageDataToCanvas(imageData);
        const { tensor, resizedW, resizedH } = preprocessSubjectInput(canvas, SUBJECT_INPUT_LONG_SIDE);

        const encResult = await encoder.run({ input_image: tensor });
        cachedEncoding = {
            image_embeddings: encResult.image_embeddings,
            resizedW,
            resizedH,
            srcW: imageData.width,
            srcH: imageData.height
        };
        cachedEncodingSourceRef = imageData;
        console.timeEnd("⏱️ AIMaskEngine : encodage image Sujet (MobileSAM)");
    }

    console.time("⏱️ AIMaskEngine : décodage clic Sujet (MobileSAM)");
    const enc = cachedEncoding;

    // Point normalisé (0..1, image source) -> espace redimensionné (voir
    // preprocessSubjectInput, pas de padding donc pas d'offset à gérer).
    const pointX = x * enc.resizedW;
    const pointY = y * enc.resizedH;

    // 🔹 Contrat exact de la démo akbartus/MobileSAM-in-the-Browser (js/main.js) :
    // point_labels utilise 0 pour "premier plan" (PAS 1, contrairement à la
    // convention SAM2) et orig_im_size demande au décodeur de renvoyer
    // directement le masque à la résolution voulue — ici la résolution de la
    // photo SOURCE, pour éviter un recadrage/redimensionnement manuel.
    const feeds = {
        image_embeddings: enc.image_embeddings,
        point_coords: new ort.Tensor("float32", Float32Array.from([pointX, pointY, 0, 0]), [1, 2, 2]),
        point_labels: new ort.Tensor("float32", Float32Array.from([0, -1]), [1, 2]),
        mask_input: new ort.Tensor("float32", new Float32Array(SUBJECT_MASK_SIZE * SUBJECT_MASK_SIZE), [1, 1, SUBJECT_MASK_SIZE, SUBJECT_MASK_SIZE]),
        has_mask_input: new ort.Tensor("float32", Float32Array.from([0]), [1]),
        orig_im_size: new ort.Tensor("float32", Float32Array.from([enc.srcH, enc.srcW]), [2])
    };

    const decResult = await decoder.run(feeds);
    console.timeEnd("⏱️ AIMaskEngine : décodage clic Sujet (MobileSAM)");

    const maskTensor = decResult.masks;
    const [, , maskH, maskW] = maskTensor.dims;
    const raw = maskTensor.data;

    // Conversion logits -> probabilité (sigmoid standard SAM), pour un bord
    // de masque progressif plutôt qu'un seuil dur — cohérent avec les autres
    // types de masques (Linéaire/Radial/Pinceau), tous à bord dégradé.
    const alpha = new Float32Array(maskW * maskH);
    for (let i = 0; i < alpha.length; i++) alpha[i] = 1 / (1 + Math.exp(-raw[i]));

    // orig_im_size DEVRAIT déjà donner un masque à la résolution de la photo
    // source (voir commentaire ci-dessus) — filet de sécurité si jamais ce
    // n'est pas le cas pour ce modèle précis.
    return resizeAlphaStretch(alpha, maskW, maskH, enc.srcW, enc.srcH);
}

window.AIMaskEngine = {
    loadSkyModel,
    loadSam2Models,
    segmentSky,
    segmentSubjectAtPoint
};
