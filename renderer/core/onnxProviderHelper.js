/*=========================================================
    Pixel RAW - Sélection du moteur d'inférence onnxruntime-web

    Tente WebGPU (accélération GPU) en premier, repli EXPLICITE sur WASM
    (CPU) si la création de session échoue. Ne compte PAS uniquement sur
    executionProviders: ["webgpu", "wasm"] — le repli automatique
    d'onnxruntime-web en cas d'échec d'INIT n'est pas garanti dans tous les
    cas (voir microsoft/onnxruntime#20729, constaté pour webnn, même classe
    de problème pour webgpu) — d'où ce repli géré nous-mêmes, avec un log
    clair du moteur réellement retenu.

    Nécessite un import de "onnxruntime-web/dist/ort.all.min.mjs" (PAS
    ort.min.mjs, qui n'embarque pas le backend WebGPU) côté appelant, pour
    que "webgpu" ET "wasm" soient tous deux réellement disponibles dans le
    même bundle.
=========================================================*/

/**
 * @param {typeof import("onnxruntime-web")} ort
 * @param {string} modelPath
 * @param {string} label - nom du modèle, pour le log (ex: "Débruitage neuronal (NAFNet)")
 * @returns {Promise<{session: import("onnxruntime-web").InferenceSession, provider: "webgpu"|"wasm"}>}
 */
export async function createSessionWithFallback(ort, modelPath, label) {
    try {
        const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["webgpu"] });
        console.log(`✅ [${label}] Moteur d'inférence : WebGPU (accélération GPU active)`);
        return { session, provider: "webgpu" };
    } catch (err) {
        console.warn(`⚠️ [${label}] WebGPU indisponible ou échec de création de session (${err && err.message ? err.message : err}) — repli sur WASM (CPU)`);
        const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
        console.log(`✅ [${label}] Moteur d'inférence : WASM (CPU)`);
        return { session, provider: "wasm" };
    }
}
