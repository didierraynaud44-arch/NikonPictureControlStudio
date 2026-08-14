/*=========================================================
    Pixel RAW - Worker de débruitage neuronal (NAFNet)

    Web Worker DÉDIÉ (type module) : l'inférence NAFNet est trop lente pour
    tourner sur le thread principal sans geler l'interface (contrairement aux
    modèles de AIMaskEngine.js, qui ne tournent qu'une fois sur une image
    réduite). Un seul Worker, créé et réutilisé par NeuralDenoiseEngine.js,
    qui lui envoie une tuile 768x768 à la fois et attend le résultat.

    Import de "ort.all.min.mjs" (PAS ort.min.mjs, voir onnxProviderHelper.js)
    pour avoir WebGPU ET WASM tous deux disponibles dans le même bundle —
    nécessaire pour le repli explicite en cas d'échec WebGPU (création DE
    session ou échec pendant l'inférence, voir forceFallbackToWasm ci-dessous).
    Même raison qu'AIMaskEngine.js de résoudre le chemin du modèle via
    import.meta.url plutôt qu'un chemin relatif nu.
=========================================================*/

import * as ort from "../../node_modules/onnxruntime-web/dist/ort.all.min.mjs";
import { createSessionWithFallback } from "./onnxProviderHelper.js";

const MODEL_PATH = new URL("../../assets/ai-models/denoise-nafnet.onnx", import.meta.url).href;
const TILE_SIZE = 768;
const LABEL = "Débruitage neuronal (NAFNet)";

let session = null;
let sessionPromise = null;
let activeProvider = null; // "webgpu" | "wasm", pour le log et le repli d'inférence

async function loadModel() {
    if (session) return session;
    if (sessionPromise) return sessionPromise;

    sessionPromise = createSessionWithFallback(ort, MODEL_PATH, LABEL).then(({ session: s, provider }) => {
        session = s;
        activeProvider = provider;
        return s;
    });

    return sessionPromise;
}

/**
 * Repli DÉFINITIF vers WASM pour le reste du traitement, appelé quand
 * l'inférence échoue en cours de job alors que WebGPU avait pourtant réussi
 * à créer sa session (échec à l'exécution, pas à l'init — voir onmessage
 * ci-dessous). Le job continue sans planter, juste plus lentement, comme
 * demandé.
 */
async function forceFallbackToWasm(err) {
    console.warn(`⚠️ [${LABEL}] Échec d'inférence WebGPU en cours de traitement (${err && err.message ? err.message : err}) — repli définitif sur WASM (CPU) pour la suite du job`);
    const s = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ["wasm"] });
    session = s;
    activeProvider = "wasm";
    sessionPromise = Promise.resolve(s);
    console.log(`✅ [${LABEL}] Moteur d'inférence : WASM (CPU) [repli après échec WebGPU]`);
    return s;
}

self.onmessage = async (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "denoiseTile") return;

    const { id, tile } = msg;

    try {
        let loadedSession = await loadModel();

        const inputName = loadedSession.inputNames[0];
        const outputName = loadedSession.outputNames[0];
        const inputTensor = new ort.Tensor("float32", tile, [1, 3, TILE_SIZE, TILE_SIZE]);

        let results;
        try {
            results = await loadedSession.run({ [inputName]: inputTensor });
        } catch (runErr) {
            // 🔹 Échec à L'EXÉCUTION (pas à la création) : seul WebGPU peut
            // échouer ainsi de façon récupérable (opérateur non supporté,
            // etc.) — WASM couvre 100% des opérateurs ONNX, un échec WASM
            // est donc traité comme fatal (voir le catch englobant).
            if (activeProvider === "webgpu") {
                loadedSession = await forceFallbackToWasm(runErr);
                results = await loadedSession.run({ [inputName]: inputTensor });
            } else {
                throw runErr;
            }
        }

        // 🔹 Copie dans un Float32Array frais : results[outputName].data peut être
        // une vue interne réutilisée par onnxruntime-web, pas sûre à transférer.
        const output = Float32Array.from(results[outputName].data);

        self.postMessage({ type: "tileResult", id, result: output, provider: activeProvider }, [output.buffer]);
    } catch (err) {
        self.postMessage({ type: "error", id, message: err && err.message ? err.message : String(err) });
    }
};
