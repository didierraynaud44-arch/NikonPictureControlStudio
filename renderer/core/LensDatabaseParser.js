/*=========================================================
    Pixel RAW - Analyseur de base de données Lensfun

    Parse les fichiers XML au format Lensfun (assets/lens-database/, base
    embarquée CC BY-SA 3.0 — voir assets/lens-database/NOTICE) ET les profils
    importés manuellement par l'utilisateur (userData/lens-profiles/, voir
    main.js import-lens-profile). Chargement PARESSEUX (jamais au démarrage),
    mis en cache en mémoire pour la session.

    N'implémente PAS le pipeline de coordonnées interne complet de la
    bibliothèque C++ Lensfun (rescale_polynomial_coefficients, RealFocal vs
    focale nominale, décentrage d'objectif) — simplification délibérée :
    chaque modèle est évalué directement dans son système de coordonnées
    natif (Hugin pour distorsion/TCA, coin d'image pour vignettage pa), sans
    la conversion vers le système "natural" unifié de Lensfun. Suffisant pour
    une correction ponctuelle indépendante ; pas de composition avec d'autres
    transformations géométriques (perspective, etc., qu'on n'implémente pas).
=========================================================*/

(function () {

let embeddedLenses = [];
let importedLenses = [];
let loadPromise = null;

function pathToFileUrl(p) {
    const formatted = p.replace(/\\/g, "/");
    return formatted.startsWith("/") ? `file://${formatted}` : `file:///${formatted}`;
}

async function fetchXmlText(filePath) {
    const res = await fetch(pathToFileUrl(filePath));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

function textOf(el, tag) {
    const child = el.querySelector(tag);
    return child ? child.textContent.trim() : "";
}

/**
 * Parse un document XML au format Lensfun (<lens>...<calibration>...).
 * @returns {Array} lentilles trouvées, [] si le document n'a pas la structure attendue
 */
function parseLensfunXml(xmlText, sourceLabel) {
    let doc;
    try {
        doc = new DOMParser().parseFromString(xmlText, "application/xml");
    } catch (e) {
        return [];
    }
    if (doc.querySelector("parsererror")) return [];

    const lensEls = Array.from(doc.getElementsByTagName("lens"));
    const lenses = [];

    for (const lensEl of lensEls) {
        const maker = textOf(lensEl, "maker");
        // Un <lens> peut avoir PLUSIEURS <model> (langues différentes, voir
        // <model lang="en">) : on garde tous les noms pour la recherche tolérante.
        const models = Array.from(lensEl.children)
            .filter(c => c.tagName === "model")
            .map(m => m.textContent.trim())
            .filter(Boolean);
        if (!models.length) continue;

        const mount = textOf(lensEl, "mount");
        const cropFactor = parseFloat(textOf(lensEl, "cropfactor")) || null;

        const calibEl = lensEl.querySelector("calibration");
        const distortion = [];
        const vignetting = [];
        const tca = [];

        if (calibEl) {
            for (const el of Array.from(calibEl.children)) {
                const focal = parseFloat(el.getAttribute("focal"));
                if (!isFinite(focal)) continue;

                if (el.tagName === "distortion") {
                    const model = el.getAttribute("model");
                    if (model !== "ptlens" && model !== "poly3" && model !== "poly5") continue;
                    distortion.push({
                        model, focal,
                        a: parseFloat(el.getAttribute("a")) || 0,
                        b: parseFloat(el.getAttribute("b")) || 0,
                        c: parseFloat(el.getAttribute("c")) || 0,
                        k1: parseFloat(el.getAttribute("k1")) || 0,
                        k2: parseFloat(el.getAttribute("k2")) || 0
                    });
                } else if (el.tagName === "vignetting") {
                    if (el.getAttribute("model") !== "pa") continue;
                    vignetting.push({
                        focal,
                        aperture: parseFloat(el.getAttribute("aperture")) || 0,
                        distance: parseFloat(el.getAttribute("distance")) || 1000,
                        k1: parseFloat(el.getAttribute("k1")) || 0,
                        k2: parseFloat(el.getAttribute("k2")) || 0,
                        k3: parseFloat(el.getAttribute("k3")) || 0
                    });
                } else if (el.tagName === "tca") {
                    const model = el.getAttribute("model");
                    if (model === "poly3") {
                        tca.push({
                            focal,
                            vr: el.hasAttribute("vr") ? parseFloat(el.getAttribute("vr")) : 1,
                            vb: el.hasAttribute("vb") ? parseFloat(el.getAttribute("vb")) : 1,
                            cr: parseFloat(el.getAttribute("cr")) || 0,
                            cb: parseFloat(el.getAttribute("cb")) || 0,
                            br: parseFloat(el.getAttribute("br")) || 0,
                            bb: parseFloat(el.getAttribute("bb")) || 0
                        });
                    } else if (model === "linear") {
                        // 🔹 Normalisé vers la même représentation interne que poly3
                        // (vr/vb purs, br=cr=bb=cb=0) — voir kr/kb dans le XML source,
                        // le filtre n'a qu'UN SEUL modèle TCA à gérer.
                        tca.push({
                            focal,
                            vr: el.hasAttribute("kr") ? parseFloat(el.getAttribute("kr")) : 1,
                            vb: el.hasAttribute("kb") ? parseFloat(el.getAttribute("kb")) : 1,
                            cr: 0, cb: 0, br: 0, bb: 0
                        });
                    }
                }
            }
        }

        if (!distortion.length && !vignetting.length && !tca.length) continue; // rien à corriger

        lenses.push({ maker, models, mount, cropFactor, distortion, vignetting, tca, source: sourceLabel });
    }

    return lenses;
}

async function loadFileList(ipcMethodName) {
    if (!window.electronAPI || typeof window.electronAPI[ipcMethodName] !== "function") return [];
    try {
        return await window.electronAPI[ipcMethodName]();
    } catch (e) {
        console.error(`❌ Erreur ${ipcMethodName} :`, e);
        return [];
    }
}

async function loadAllLenses() {
    const [dbFiles, importedFiles] = await Promise.all([
        loadFileList("listLensDatabaseFiles"),
        loadFileList("listImportedLensProfiles")
    ]);

    const loadFiles = async (files, label) => {
        const results = await Promise.all(files.map(async (filePath) => {
            try {
                const xmlText = await fetchXmlText(filePath);
                return parseLensfunXml(xmlText, label);
            } catch (e) {
                console.error(`❌ Erreur lecture profil objectif ${filePath} :`, e);
                return [];
            }
        }));
        return results.flat();
    };

    embeddedLenses = await loadFiles(dbFiles, "embedded");
    importedLenses = await loadFiles(importedFiles, "imported");

    console.log(`✅ Base d'objectifs chargée : ${embeddedLenses.length} objectifs embarqués, ${importedLenses.length} importés manuellement`);
}

/** Chargement paresseux, une seule fois par session — appels concurrents partagent la même promesse. */
function ensureLoaded() {
    if (!loadPromise) loadPromise = loadAllLenses();
    return loadPromise;
}

/** Force un rechargement (après un import manuel, voir Étape 6). */
async function reload() {
    loadPromise = loadAllLenses();
    return loadPromise;
}

// ---------------------------------------------------------------
// Recherche tolérante du modèle d'objectif
// ---------------------------------------------------------------

function normalizeModelString(s) {
    return (s || "")
        .toLowerCase()
        .replace(/[()]/g, " ")
        .replace(/f\s*\/\s*/g, "f")     // "f/4" -> "f4", "f / 4" -> "f4"
        .replace(/(\d)\s*mm/g, "$1mm")  // "24 mm" -> "24mm"
        .replace(/[-–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(normalized) {
    return normalized.split(/[\s,;/]+/).filter(Boolean);
}

/**
 * Score de correspondance entre la chaîne recherchée et un nom de modèle
 * candidat de la base : proportion de tokens de la recherche retrouvés tels
 * quels dans le candidat (ordre indifférent) — tolère les variations de
 * préfixe marque, de ponctuation, d'ordre des mots.
 */
function matchScore(queryTokens, candidateNormalized) {
    if (!queryTokens.length) return 0;
    let hits = 0;
    for (const t of queryTokens) {
        if (candidateNormalized.includes(t)) hits++;
    }
    return hits / queryTokens.length;
}

const MATCH_THRESHOLD = 0.6;

// 🔹 Marques de boîtier dont la monture est EXCLUSIVE à cette marque (un
// objectif Canon EF-S ne peut physiquement pas se monter sur un boîtier
// Nikon, etc.). Sert à ÉCARTER les faux positifs inter-marques quand le nom
// d'objectif renvoyé par l'EXIF est générique et sans marque (ex. le champ
// [Nikon]Lens de secours "18-55mm f/3.5-5.6" — Canon, Samsung ET Sony ont
// CHACUN un objectif du même nom générique dans la base Lensfun). Ne filtre
// PAS les objectifs tiers (Sigma/Tamron/Tokina/Samyang/Zeiss...), disponibles
// dans plusieurs montures et donc légitimement compatibles quelle que soit
// la marque du boîtier.
const CAMERA_EXCLUSIVE_MAKERS = ["canon", "sony", "pentax", "olympus", "om digital", "panasonic", "fujifilm", "samsung", "nikon"];

function normalizeMaker(s) {
    return (s || "").toLowerCase().replace(/corporation|corp\.?|inc\.?/g, "").trim();
}

/**
 * Trouve le meilleur objectif correspondant à lensModelString parmi la base
 * embarquée ET les profils importés (importés PRIORITAIRES en cas d'égalité
 * de score, supposés plus récents/spécifiques). cameraMake (EXIF Make du
 * boîtier, ex. "NIKON CORPORATION") sert uniquement à écarter les objectifs
 * d'une AUTRE marque à monture exclusive — voir CAMERA_EXCLUSIVE_MAKERS.
 * @returns {{lens: object, score: number}|null}
 */
function findBestLensMatch(lensModelString, cameraMake) {
    if (!lensModelString) return null;
    const normalizedQuery = normalizeModelString(lensModelString);
    const queryTokens = tokenize(normalizedQuery);

    const normalizedCameraMake = normalizeMaker(cameraMake);
    const cameraBrand = CAMERA_EXCLUSIVE_MAKERS.find(b => normalizedCameraMake.includes(b));

    let best = null;
    // Importés en dernier : à score égal, Array.find-style "dernier meilleur
    // gagne" ci-dessous les fait primer sur l'embarqué.
    const pools = [embeddedLenses, importedLenses];

    for (const pool of pools) {
        for (const lens of pool) {
            if (cameraBrand) {
                const lensMaker = normalizeMaker(lens.maker);
                const isOtherExclusiveBrand = CAMERA_EXCLUSIVE_MAKERS.some(b => b !== cameraBrand && lensMaker.includes(b));
                if (isOtherExclusiveBrand) continue; // monture incompatible avec le boîtier
            }

            for (const modelName of lens.models) {
                const normalizedCandidate = normalizeModelString(modelName);
                // Correspondance exacte : gagne immédiatement.
                if (normalizedCandidate === normalizedQuery) {
                    return { lens, score: 1 };
                }
                const score = matchScore(queryTokens, normalizedCandidate);
                if (score >= MATCH_THRESHOLD && (!best || score >= best.score)) {
                    best = { lens, score };
                }
            }
        }
    }

    return best;
}

/**
 * Interpole LINÉAIREMENT entre les deux entrées calibrées dont la focale
 * encadre focalLength (ou renvoie l'entrée la plus proche si focalLength est
 * hors plage). `numericFields` : les clés à interpoler (les autres, ex.
 * "model", sont recopiées depuis l'entrée la plus proche).
 */
function interpolateByFocal(entries, focalLength, numericFields) {
    if (!entries.length) return null;
    const sorted = entries.slice().sort((a, b) => a.focal - b.focal);

    if (focalLength <= sorted[0].focal) return sorted[0];
    if (focalLength >= sorted[sorted.length - 1].focal) return sorted[sorted.length - 1];

    let lo = sorted[0], hi = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].focal <= focalLength && focalLength <= sorted[i + 1].focal) {
            lo = sorted[i];
            hi = sorted[i + 1];
            break;
        }
    }
    if (lo.focal === hi.focal) return lo;

    const t = (focalLength - lo.focal) / (hi.focal - lo.focal);
    const out = { ...lo };
    for (const field of numericFields) {
        out[field] = lo[field] + (hi[field] - lo[field]) * t;
    }
    return out;
}

/**
 * Point d'entrée principal : trouve le profil pour cet objectif/focale/
 * ouverture, avec les coefficients de distorsion/vignettage/TCA déjà
 * interpolés et prêts à l'emploi par LensCorrectionFilter.
 * @returns {Promise<object|null>} null si aucun profil trouvé
 */
async function findLensProfile(lensModelString, focalLength, aperture, cameraMake) {
    await ensureLoaded();

    const match = findBestLensMatch(lensModelString, cameraMake);
    if (!match) return null;
    const lens = match.lens;

    const focal = parseFloat(focalLength) || 0;
    const targetAperture = parseFloat(aperture) || 0;

    const distortion = lens.distortion.length
        ? interpolateByFocal(lens.distortion, focal, ["a", "b", "c", "k1", "k2"])
        : null;

    const tca = lens.tca.length
        ? interpolateByFocal(lens.tca, focal, ["vr", "vb", "cr", "cb", "br", "bb"])
        : null;

    let vignetting = null;
    if (lens.vignetting.length) {
        // Vignettage indexé par (focale, ouverture, distance) : d'abord la
        // focale la plus proche, puis parmi les entrées à cette focale,
        // l'ouverture la plus proche (l'app ne gère pas la distance de mise
        // au point — on garde l'entrée à la plus grande distance disponible,
        // représentative du cas le plus courant, mise au point lointaine).
        const focals = [...new Set(lens.vignetting.map(v => v.focal))].sort((a, b) => a - b);
        const closestFocal = focals.reduce((prev, curr) =>
            Math.abs(curr - focal) < Math.abs(prev - focal) ? curr : prev
        );
        const atFocal = lens.vignetting.filter(v => v.focal === closestFocal);
        const maxDistance = Math.max(...atFocal.map(v => v.distance));
        const atDistance = atFocal.filter(v => v.distance === maxDistance);

        vignetting = atDistance.reduce((prev, curr) =>
            Math.abs(curr.aperture - targetAperture) < Math.abs(prev.aperture - targetAperture) ? curr : prev
        );
    }

    if (!distortion && !vignetting && !tca) return null;

    return {
        lensName: lens.models[0],
        maker: lens.maker,
        source: lens.source,
        matchScore: match.score,
        distortion,
        vignetting,
        tca
    };
}

window.LensDatabaseParser = {
    findLensProfile,
    reload,
    parseLensfunXml // exposé pour la validation d'un import manuel (Étape 6)
};

})();
