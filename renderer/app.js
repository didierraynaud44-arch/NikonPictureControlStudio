/*=========================================================
    Nikon Picture Control Studio - Controller (app.js)
    Version avec persistance des réglages Picture Control
=========================================================*/

let currentNefFileName = "image-editee";
let profileImageProcessor = null;
let activeProfilePC = null; // Picture Control actif dans le Gestionnaire

// 🔹 Profil Standard neutre COMPLET (mêmes valeurs que getDefaultPictureControl()
// côté main.js) : source unique pour "Réinitialiser" et pour la remise à zéro
// systématique du Gestionnaire de Profils (import d'une nouvelle photo de test).
// Les champs du module Monochrome (mixeur 8 canaux, Lumière tamisée, Dodge &
// Burn, gomme locale) ne figurent PAS ici : ils vivent dans MonochromeManager
// (état global indépendant du Picture Control, voir ImageProcessor._buildRenderSettings)
// et ne sont plus jamais fusionnés dans un rendu tant que isMonochrome n'est pas
// vrai — c'est CE gate, pas une liste de valeurs neutres dupliquée ici, qui
// garantit qu'un profil par défaut ne peut plus en hériter.
const DEFAULT_PICTURE_CONTROL = Object.freeze({
    name: "Standard",
    pictureControlName: "Standard",
    baseProfile: "STANDARD",
    basePictureControl: "STANDARD",
    isMonochrome: false,
    wbTemperature: 0,
    wbTint: 0,
    sharpening: 3.25,
    midRangeSharpening: 1,
    clarity: 0,
    contrast: 0,
    brightness: 0,
    saturation: 0,
    hue: 0,
    filterEffect: "OFF",
    toningEffect: "B&W",
    toningAmount: 1,
    exposure: 0,
    blackPoint: 0,
    whitePoint: 255,
    highlights: 0,
    shadows: 0,
    dehaze: 0,
    vibrance: 0,
    vignette: 0,
    denoise: 0,
    lensCorrection: false,
    toneCurveLut: null,
    monoFilter: "None",
    monoToning: "None"
});

// 🔹 true dès que l'utilisateur a explicitement importé une photo de test via
// "Importer un RAW" (Gestionnaire de Profils) : empêche switchToView de
// l'écraser en re-copiant la photo du Studio à chaque fois qu'on revient sur
// cette vue — une fois choisie explicitement, la photo de test reste sous le
// contrôle exclusif de l'utilisateur, indépendante du Studio.
let profileHasIndependentRaw = false;
let studioFoldersList = []; // Liste de toutes les structures de dossiers importées

// 🔹 Chemins des dossiers actuellement dépliés dans l'arbre "Dossiers Photos"
// (racines ET sous-dossiers). Source de vérité pour l'état déplié : mise à
// jour directement dans les gestionnaires de clic, puis relue par
// renderStudioFolderTree()/buildTreeHTML() à chaque reconstruction — donc
// un rafraîchissement de l'arbre (ex: après "Ouvrir avec") ne referme plus
// les dossiers que l'utilisateur avait ouverts.
let expandedFolders = new Set();

// Stockage local de la bibliothèque NP3 / Profils
let np3Library = [];
try {
    np3Library = JSON.parse(localStorage.getItem("nikon_np3_library") || "[]");
} catch (e) {
    console.error("❌ Erreur de lecture de la bibliothèque NP3 :", e);
    np3Library = [];
}

// Cache mémoire pour accélérer le passage d'une photo à l'autre
const studioImageCache = new Map();

// Qualité d'aperçu Studio (largeur max en px, transmise à readFileDirect). N'affecte
// QUE l'aperçu Studio — l'export/impression pleine résolution (exportFullResolution)
// n'utilise jamais cette valeur. Réglable via le sélecteur "Résolution" affiché dans
// l'en-tête de la zone photo (mode Photo uniquement), persistée côté main process
// (electron-store).
let studioPreviewMaxWidth = 1200;
const previewResolutionSelect = document.getElementById("previewResolutionSelect");
if (window.electronAPI && typeof window.electronAPI.getPreviewQuality === "function") {
    window.electronAPI.getPreviewQuality()
        .then((maxWidth) => {
            if (typeof maxWidth === "number" && maxWidth > 0) {
                studioPreviewMaxWidth = maxWidth;
                if (previewResolutionSelect) previewResolutionSelect.value = String(maxWidth);
            }
        })
        .catch((err) => console.warn("⚠️ Erreur lecture qualité d'aperçu:", err));
}
if (window.electronAPI && typeof window.electronAPI.onMenuSetPreviewQuality === "function") {
    window.electronAPI.onMenuSetPreviewQuality((maxWidth) => {
        if (typeof maxWidth === "number" && maxWidth > 0) {
            studioPreviewMaxWidth = maxWidth;
            if (previewResolutionSelect) previewResolutionSelect.value = String(maxWidth);
            console.log("⚙️ Qualité d'aperçu Studio mise à jour:", maxWidth);
        }
    });
}
if (previewResolutionSelect && window.electronAPI && typeof window.electronAPI.setPreviewQuality === "function") {
    previewResolutionSelect.addEventListener("change", (e) => {
        const maxWidth = parseInt(e.target.value, 10);
        if (!maxWidth) return;
        studioPreviewMaxWidth = maxWidth;
        window.electronAPI.setPreviewQuality(maxWidth)
            .catch((err) => console.warn("⚠️ Erreur enregistrement qualité d'aperçu:", err));
    });
}

// "Dernière requête gagne" : évite qu'une navigation rapide (clics successifs sur
// les flèches ‹ › du Studio) ne fasse se chevaucher plusieurs chargements async et
// n'affiche brièvement des photos intermédiaires dans le désordre.
let currentLoadToken = 0;
function updateExifBarFromDb(photo) {
    const cameraEl = document.getElementById('exifCamera');
    const lensEl = document.getElementById('exifLens');
    const paramsEl = document.getElementById('exifParams');
    
    if (!cameraEl || !lensEl || !paramsEl) return;

    const make = photo.make || '';
    const model = photo.model || '';
    cameraEl.textContent = make && model ? `${make} ${model}` : (make || model || '-');

    lensEl.textContent = photo.lens || '-';

    const params = [];
    if (photo.focal_length) params.push(`${photo.focal_length}mm`);
    if (photo.aperture) params.push(`f/${photo.aperture}`);
    if (photo.shutter_speed) params.push(photo.shutter_speed);
    if (photo.iso) params.push(`ISO ${photo.iso}`);
    if (photo.exposure_compensation) params.push(`EV ${photo.exposure_compensation}`);
    if (photo.white_balance) params.push(photo.white_balance);
    if (photo.date_time_original) params.push(new Date(photo.date_time_original).toLocaleDateString());

    // params peut contenir du texte EXIF non fiable (white_balance) : on reste sur
    // .textContent ici (jamais innerHTML) pour ne jamais exécuter du HTML/script
    // injecté via des métadonnées de fichier malveillantes.
    paramsEl.textContent = params.length > 0 ? params.join(' | ') : 'Aucune EXIF';

    // Le compteur de déclenchements est affiché séparément, construit uniquement
    // via des éléments DOM sûrs (jamais de chaîne HTML), la valeur étant numérique.
    const shutterCount = photo.shutter_count || photo.shutterCount;
    const shutterBadge = document.getElementById('exifShutterBadge');
    if (shutterBadge) {
        shutterBadge.innerHTML = "";
        if (shutterCount && window.lucideIconElement) {
            shutterBadge.appendChild(window.lucideIconElement("camera", { size: 12 }));
            shutterBadge.appendChild(document.createTextNode(String(parseInt(shutterCount, 10) || shutterCount)));
            shutterBadge.style.display = "inline-flex";
        } else {
            shutterBadge.style.display = "none";
        }
    }
}

/**
 * 🔹 Récupère le ShutterCount en tâche de fond, APRÈS que la photo et ses EXIF
 * principales soient déjà affichées (ne bloque jamais loadImageInStudio : pas
 * de await côté appelant). Met à jour le cache mémoire (studioImageCache) et,
 * seulement si l'utilisateur regarde toujours cette photo à la réception de la
 * réponse, rafraîchit uniquement le champ ShutterCount de la barre EXIF.
 */
function fetchShutterCountInBackground(filePath, fileInfo) {
    if (fileInfo.shutterCount) return; // déjà connu (cache réutilisé sans réappel)
    if (!window.electronAPI || typeof window.electronAPI.getShutterCount !== "function") return;

    window.electronAPI.getShutterCount(filePath)
        .then((result) => {
            if (!result || !result.success || !result.shutterCount) return;

            // Mémorise le résultat pour la session, même si l'utilisateur a
            // déjà navigué vers une autre photo entre-temps.
            fileInfo.shutterCount = result.shutterCount;
            const cached = studioImageCache.get(filePath);
            if (cached) cached.shutterCount = result.shutterCount;

            // N'actualise l'affichage que si cette photo est toujours à l'écran.
            if (window.currentStudioFilePath !== filePath) return;

            updateExifBarFromDb({
                make: fileInfo.make || null,
                model: fileInfo.model || null,
                lens: fileInfo.lens || fileInfo.lensModel || null,
                iso: fileInfo.iso || null,
                aperture: fileInfo.aperture || null,
                focal_length: fileInfo.focalLength || null,
                shutter_speed: fileInfo.shutterSpeed || null,
                exposure_compensation: fileInfo.exposureCompensation || null,
                white_balance: fileInfo.whiteBalance || null,
                date_time_original: fileInfo.dateTimeOriginal || null,
                shutter_count: result.shutterCount
            });
            console.log("🔢 ShutterCount mis à jour en arrière-plan:", result.shutterCount);
        })
        .catch((err) => {
            console.warn("⚠️ Erreur récupération ShutterCount en arrière-plan:", err);
        });
}
// ============================================================
// GESTION DE LA PERSISTANCE DES RÉGLAGES PICTURE CONTROL
// ============================================================

let currentSettingsSaveTimeout = null;

/**
 * Sauvegarde automatique des réglages Picture Control
 */
async function saveCurrentPictureControlSettings(filePath) {
    if (!filePath) {
        console.warn("⚠️ Aucun fichier chargé pour sauvegarder");
        return;
    }

    try {
        if (!window.imageProcessor) {
            console.warn("⚠️ imageProcessor non disponible");
            return;
        }

        const baseSettings = window.imageProcessor.getPictureControl ?
            window.imageProcessor.getPictureControl() :
            window.imageProcessor.pictureControl;

        if (!baseSettings) {
            console.warn("⚠️ Aucun réglage à sauvegarder");
            return;
        }

        // 🔹 Les retouches (tampon de duplication) et les réglages Simulation
        // Pellicule sont des champs dédiés dans la même structure JSON, à côté
        // des réglages Picture Control.
        const settings = { ...baseSettings };
        if (typeof window.RetouchManager !== "undefined") {
            settings.retouches = window.RetouchManager.getRetouches();
        }
        if (window.imageProcessor && typeof window.imageProcessor.getFilmSettings === "function") {
            settings.filmSettings = window.imageProcessor.getFilmSettings();
        }
        if (typeof window.MonochromeManager !== "undefined") {
            settings.monochromeStudio = window.MonochromeManager.getSettings();
        }

        console.log("💾 Sauvegarde des réglages pour:", filePath);

        if (window.electronAPI && typeof window.electronAPI.savePhotoSettings === "function") {
            const result = await window.electronAPI.savePhotoSettings(filePath, settings);
            if (result && result.success !== false) {
                console.log("✅ Réglages sauvegardés avec succès");
                return result;
            } else {
                console.error("❌ Erreur sauvegarde:", result?.error);
                return null;
            }
        }
    } catch (err) {
        console.error("❌ Erreur sauvegarde automatique:", err);
        return null;
    }
}

/**
 * 💾 Sauvegarde automatique des réglages de la photo active dans SQLite en temps réel
 */
async function saveCurrentPhotoSettingsToCatalog() {
    if (!window.currentStudioFilePath) return;
    const currentPC = window.imageProcessor?.pictureControl || activeProfilePC || {};

    // 🔹 Les retouches (tampon de duplication) et les réglages Simulation
    // Pellicule sont des champs dédiés dans la même structure JSON, à côté des
    // réglages Picture Control.
    const settingsToSave = { ...currentPC };
    if (typeof window.RetouchManager !== "undefined") {
        settingsToSave.retouches = window.RetouchManager.getRetouches();
    }
    if (window.imageProcessor && typeof window.imageProcessor.getFilmSettings === "function") {
        settingsToSave.filmSettings = window.imageProcessor.getFilmSettings();
    }
    if (typeof window.MonochromeManager !== "undefined") {
        settingsToSave.monochromeStudio = window.MonochromeManager.getSettings();
    }

    if (window.electronAPI && typeof window.electronAPI.savePhotoSettings === "function") {
        try {
            await window.electronAPI.savePhotoSettings(window.currentStudioFilePath, settingsToSave);
            console.log("💾 Réglages sauvegardés automatiquement pour:", window.currentStudioFilePath);
        } catch (err) {
            console.error("❌ Erreur lors de la sauvegarde automatique des réglages :", err);
        }
    }
}

/**
 * Charge les réglages sauvegardés pour une photo
 */
async function loadPictureControlSettings(filePath) {
    if (!filePath) return null;

    try {
        console.log("📂 Chargement des réglages pour:", filePath);

        let settings = null;
        
        if (window.electronAPI && typeof window.electronAPI.getPhotoSettings === "function") {
            settings = await window.electronAPI.getPhotoSettings(filePath);
        }

        if (settings) {
            console.log("📂 Réglages chargés depuis la base");
            return settings;
        } else {
            console.log("📂 Aucun réglage trouvé pour cette photo");
            return null;
        }
    } catch (err) {
        console.error("❌ Erreur chargement réglages:", err);
        return null;
    }
}

/**
 * Applique les réglages à l'imageProcessor
 */
function applySettingsToImageProcessor(settings) {
    if (!settings || !window.imageProcessor) return;

    console.log("🎨 Application des réglages à l'image:", Object.keys(settings));
    
    try {
        const pcData = { ...settings };
        
        if (typeof window.imageProcessor.setPictureControl === "function") {
            window.imageProcessor.setPictureControl(pcData);
        } else {
            window.imageProcessor.pictureControl = pcData;
        }
        
        if (typeof window.updatePictureControl === "function") {
            window.updatePictureControl({
                pictureControl: pcData,
                isNewFile: false
            }, true);
        }
        
        console.log("✅ Réglages appliqués à l'image");
    } catch (err) {
        console.error("❌ Erreur application des réglages:", err);
    }
}

/**
 * Applique les réglages aux curseurs de l'interface
 */
function applySettingsToSliders(settings) {
    if (!settings) return;
    
    console.log("🎛️ Application des réglages aux curseurs:", Object.keys(settings));
    
    const sliders = document.querySelectorAll('input[type="range"]');
    sliders.forEach(slider => {
        const key = slider.id || slider.name;
        if (key && settings[key] !== undefined) {
            const value = settings[key];
            slider.value = value;
            const display = document.getElementById(`${key}-value`);
            if (display) {
                display.textContent = value;
            }
            console.log(`  - ${key}: ${value}`);
        }
    });
}

// ============================================================
// FIN GESTION PERSISTANCE
// ============================================================

/**
 * Extrait tous les fichiers d'un nœud de dossier pour alimenter la grille
 */
function collectAllFilesFromFolder(node) {
    let files = [];
    if (!node) return files;
    if (node.files && node.files.length > 0) {
        files = files.concat(node.files);
    }
    if (node.children && node.children.length > 0) {
        node.children.forEach(child => {
            files = files.concat(collectAllFilesFromFolder(child));
        });
    }
    return files;
}

/* =========================================================
    MODULE ARBORESCENCE DOSSIERS / FICHIERS (STUDIO)
========================================================= */

/**
 * Construit récursivement l'arborescence HTML (Fermée par défaut avec tri naturel)
 */
/**
 * 🔹 NOUVEAU : Met en surbrillance l'élément correspondant au fichier actuellement affiché
 * dans l'arbre "Dossiers Photos", quelle que soit la façon dont la photo a été chargée
 * (clic direct dans la liste, flèches de navigation, chargement initial...).
 * Ne reconstruit pas l'arbre (contrairement à renderStudioFolderTree), donc ne referme
 * pas les dossiers dépliés.
 */
function highlightSelectedTreeItem(filePath) {
    if (!filePath) return;
    const normalize = (p) => (p || "").toString().replace(/\\/g, "/").toLowerCase();
    const target = normalize(filePath);

    document.querySelectorAll(".tree-file-item").forEach(el => {
        const isMatch = normalize(el.dataset.path) === target;
        el.style.background = isMatch ? "#1a73e8" : "transparent";
        el.style.color = isMatch ? "#ffffff" : "#b0b5ba";
        if (isMatch) {
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    });
}
window.highlightSelectedTreeItem = highlightSelectedTreeItem;

/**
 * Cherche le chemin de fichier normalisé dans un noeud de l'arborescence
 * (récursif), et retourne la chaîne des chemins de dossiers ancêtres
 * (racine incluse) jusqu'à lui, ou null s'il n'y est pas.
 */
function findAncestorFolderPaths(node, normalizedTargetPath, trail = []) {
    if (!node) return null;
    const currentTrail = [...trail, node.path];

    if (node.files && node.files.some(f => (f.path || "").replace(/\\/g, "/").toLowerCase() === normalizedTargetPath)) {
        return currentTrail;
    }
    if (node.children) {
        for (const child of node.children) {
            const result = findAncestorFolderPaths(child, normalizedTargetPath, currentTrail);
            if (result) return result;
        }
    }
    return null;
}

function buildTreeHTML(node) {
    if (!node) return document.createTextNode("");

    const ul = document.createElement("ul");
    ul.style.listStyle = "none";
    ul.style.paddingLeft = "10px";
    ul.style.margin = "0";

    if (node.children && node.children.length > 0) {
        const sortedChildren = [...node.children].sort((a, b) => {
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        sortedChildren.forEach(subFolder => {
            const li = document.createElement("li");
            li.style.margin = "2px 0";

            const title = document.createElement("div");
            title.className = "tree-folder-title";
            title.style.cursor = "pointer";
            title.style.fontWeight = "bold";
            title.style.color = "#e8eaed";
            title.style.fontSize = "12px";
            title.style.padding = "2px 4px";
            title.style.borderRadius = "3px";
            title.style.display = "flex";
            title.style.alignItems = "center";
            title.style.gap = "5px";

            const isExpanded = expandedFolders.has(subFolder.path);
            title.innerHTML = `<span class="tree-folder-icon">${window.lucideIconHtml(isExpanded ? "folder-open" : "folder", { size: 14 })}</span><span style="user-select:none;">${subFolder.name}</span>`;

            const subTreeContainer = document.createElement("div");
            subTreeContainer.style.display = isExpanded ? "block" : "none";

            title.onclick = (e) => {
                e.stopPropagation();
                const isHidden = subTreeContainer.style.display === "none";
                subTreeContainer.style.display = isHidden ? "block" : "none";
                if (isHidden) expandedFolders.add(subFolder.path);
                else expandedFolders.delete(subFolder.path);

                const iconEl = title.querySelector(".tree-folder-icon");
                if (iconEl) iconEl.innerHTML = window.lucideIconHtml(isHidden ? "folder-open" : "folder", { size: 14 });

                if (window.gridManager) {
                    const subFiles = collectAllFilesFromFolder(subFolder);
                    window.gridManager.setImages(subFiles);
                }
            };

            li.appendChild(title);
            li.appendChild(subTreeContainer);
            subTreeContainer.appendChild(buildTreeHTML(subFolder));
            ul.appendChild(li);
        });
    }

    if (node.files && node.files.length > 0) {
        const sortedFiles = [...node.files].sort((a, b) => {
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        sortedFiles.forEach(file => {
            const li = document.createElement("li");
            li.className = "tree-file-item";
            li.style.cursor = "pointer";
            li.style.padding = "3px 6px 3px 14px";
            li.style.fontSize = "11px";
            li.style.color = "#b0b5ba";
            li.style.borderRadius = "3px";
            li.style.overflow = "hidden";
            li.style.textOverflow = "ellipsis";
            li.style.whiteSpace = "nowrap";
            li.style.display = "flex";
            li.style.alignItems = "center";
            li.style.gap = "5px";
            li.innerHTML = `${window.lucideIconHtml("image", { size: 12 })}<span style="overflow:hidden; text-overflow:ellipsis;">${file.name}</span>`;
            li.title = file.path;
            li.dataset.path = file.path; // 🔹 NOUVEAU : pour retrouver l'élément depuis n'importe où (flèches incluses)

            li.onclick = async (e) => {
                e.stopPropagation();
                highlightSelectedTreeItem(file.path);

                if (typeof window.loadImageInStudio === "function") {
                    await window.loadImageInStudio(file.path);
                }
            };

            li.onmouseenter = () => { if (li.style.background !== "rgb(26, 115, 232)") li.style.background = "#2a2d32"; };
            li.onmouseleave = () => { if (li.style.background !== "rgb(26, 115, 232)") li.style.background = "transparent"; };

            ul.appendChild(li);
        });
    }

    return ul;
}

// Navigation photo précédente / suivante dans le Studio
function navigateStudioPhoto(direction) {
    if (!window.gridManager || !window.gridManager.images || window.gridManager.images.length === 0) return;
    
    const images = window.gridManager.images;
    let currentIndex = images.findIndex(img => img.path === window.currentStudioFilePath);
    
    if (currentIndex === -1 && window.currentStudioFilePath) {
        const normalizedCurrent = window.currentStudioFilePath.replace(/\\/g, "/").toLowerCase();
        currentIndex = images.findIndex(img => (img.path || "").replace(/\\/g, "/").toLowerCase() === normalizedCurrent);
    }
    
    if (currentIndex === -1) currentIndex = 0;

    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = images.length - 1;
    if (newIndex >= images.length) newIndex = 0;

    const targetImage = images[newIndex];
    if (targetImage && targetImage.path && typeof window.loadImageInStudio === "function") {
        window.loadImageInStudio(targetImage.path);
    }
}
window.navigateStudioPhoto = navigateStudioPhoto;

document.addEventListener("keydown", (e) => {
    const singleContainer = document.getElementById("singleImageContainer");
    if (!singleContainer || getComputedStyle(singleContainer).display === "none") return;

    if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateStudioPhoto(-1);
    } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateStudioPhoto(1);
    }
});

function ensureStudioNavigationArrows() {
    const container = document.getElementById("singleImageContainer");
    if (!container) return;

    if (container.querySelector(".studio-prev-btn")) return;

    container.style.position = "relative";

    const prevBtn = document.createElement("button");
    prevBtn.className = "studio-nav-btn studio-prev-btn";
    prevBtn.title = "Photo précédente (Flèche gauche)";
    prevBtn.innerHTML = window.lucideIconHtml("chevron-left", { size: 20 });
    prevBtn.onclick = () => navigateStudioPhoto(-1);

    const nextBtn = document.createElement("button");
    nextBtn.className = "studio-nav-btn studio-next-btn";
    nextBtn.title = "Photo suivante (Flèche droite)";
    nextBtn.innerHTML = window.lucideIconHtml("chevron-right", { size: 20 });
    nextBtn.onclick = () => navigateStudioPhoto(1);

    container.appendChild(prevBtn);
    container.appendChild(nextBtn);
}

function renderStudioFolderTree() {
    const container = document.getElementById("studioFolderTree");
    if (!container) return;

    container.innerHTML = "";

    if (!studioFoldersList || studioFoldersList.length === 0) {
        container.innerHTML = `<p style="color:#777; font-size:11px; font-style:italic; padding:8px; margin:0;">Aucun dossier dans le catalogue</p>`;
        if (window.gridManager) window.gridManager.setImages([]);
        if (typeof window.updateFooterCatalogStats === "function") window.updateFooterCatalogStats();
        return;
    }

    const sortedFoldersList = [...studioFoldersList].sort((a, b) => {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    // 🔹 Le dossier de la photo active doit toujours rester déplié, même s'il
    // ne l'était pas explicitement (ex: démarrage direct sur une photo).
    if (window.currentStudioFilePath) {
        const normalizedCurrent = window.currentStudioFilePath.replace(/\\/g, "/").toLowerCase();
        for (const folderStructure of sortedFoldersList) {
            const trail = findAncestorFolderPaths(folderStructure, normalizedCurrent);
            if (trail) {
                trail.forEach(p => expandedFolders.add(p));
                break;
            }
        }
    }

    sortedFoldersList.forEach((folderStructure) => {
        const rootItem = document.createElement("div");
        rootItem.style.marginBottom = "8px";
        rootItem.style.borderBottom = "1px solid #2b2d31";
        rootItem.style.paddingBottom = "4px";

        const rootHeader = document.createElement("div");
        rootHeader.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            padding: 4px;
            background: #232428;
            border-radius: 4px;
            margin-bottom: 2px;
        `;

        const rootTitle = document.createElement("div");
        rootTitle.style.cssText = "font-size: 12px; font-weight: bold; color: #5865f2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 5px;";

        const isRootExpanded = expandedFolders.has(folderStructure.path);
        rootTitle.innerHTML = `<span class="tree-folder-icon">${window.lucideIconHtml(isRootExpanded ? "folder-open" : "folder", { size: 14 })}</span><span>${folderStructure.name}</span>`;

        const rootTreeContainer = document.createElement("div");
        rootTreeContainer.style.display = isRootExpanded ? "block" : "none";

        rootHeader.onclick = (e) => {
            if (e.target.classList.contains("btn-remove-folder")) return;
            const isHidden = rootTreeContainer.style.display === "none";
            rootTreeContainer.style.display = isHidden ? "block" : "none";
            if (isHidden) expandedFolders.add(folderStructure.path);
            else expandedFolders.delete(folderStructure.path);

            const iconEl = rootTitle.querySelector(".tree-folder-icon");
            if (iconEl) iconEl.innerHTML = window.lucideIconHtml(isHidden ? "folder-open" : "folder", { size: 14 });

            if (window.gridManager) {
                const allFolderFiles = collectAllFilesFromFolder(folderStructure);
                window.gridManager.setImages(allFolderFiles);
            }
        };

        const btnRemove = document.createElement("button");
        btnRemove.className = "btn-remove-folder";
        btnRemove.title = "Retirer du catalogue";
        btnRemove.innerHTML = window.lucideIconHtml("trash-2", { size: 13 });
        btnRemove.style.cssText = "background: transparent; border: none; cursor: pointer; font-size: 11px; padding: 2px 4px; margin-left: 6px; display: inline-flex; align-items: center;";
        
        btnRemove.onclick = (e) => {
            e.stopPropagation();
            removeStudioFolder(folderStructure.path);
        };

        rootHeader.appendChild(rootTitle);
        rootHeader.appendChild(btnRemove);
        rootItem.appendChild(rootHeader);

        rootTreeContainer.appendChild(buildTreeHTML(folderStructure));
        rootItem.appendChild(rootTreeContainer);

        container.appendChild(rootItem);
    });

    if (sortedFoldersList.length > 0 && window.gridManager) {
        window.gridManager.setImages(collectAllFilesFromFolder(sortedFoldersList[0]));
    }

    if (typeof window.updateFooterCatalogStats === "function") window.updateFooterCatalogStats();
}

async function removeStudioFolder(folderPath) {
    if (window.electronAPI && typeof window.electronAPI.removeCatalogFolder === "function") {
        studioFoldersList = await window.electronAPI.removeCatalogFolder(folderPath);
        renderStudioFolderTree();
    }
}

/* =========================================================
    INDICATEUR DE PROGRESSION D'IMPORT (gros dossiers)
========================================================= */

let studioImportsInFlight = 0;
let studioRenderDebounceTimer = null;
const STUDIO_RENDER_DEBOUNCE_MS = 300;

// Ne déclenche qu'un seul rendu de l'arbre, même si plusieurs imports
// de dossiers se terminent à quelques centaines de ms d'écart. Le message
// d'attente ne disparaît qu'ici, une fois l'arbre effectivement redessiné —
// jamais avant, pour ne jamais laisser un "trou" sans retour visuel.
function scheduleStudioFolderTreeRender() {
    if (studioRenderDebounceTimer) clearTimeout(studioRenderDebounceTimer);
    studioRenderDebounceTimer = setTimeout(() => {
        studioRenderDebounceTimer = null;
        renderStudioFolderTree();
        hideStudioImportProgress();
    }, STUDIO_RENDER_DEBOUNCE_MS);
}

function updateStudioImportProgress({ indexed, total, currentFile, folderName }) {
    const text = document.getElementById("studioImportProgressText");
    const bar = document.getElementById("studioImportProgressBar");
    if (text) {
        text.textContent = total > 0
            ? `Indexation "${folderName}" : ${indexed} / ${total}${currentFile ? " — " + currentFile : ""}`
            : `Indexation en cours, veuillez patienter...`;
    }
    if (bar) {
        const pct = total > 0 ? Math.min(100, Math.round((indexed / total) * 100)) : 0;
        bar.style.width = pct + "%";
    }
}

function showStudioImportProgress(folderName) {
    const box = document.getElementById("studioImportProgress");
    if (box) box.style.display = "block";
    updateStudioImportProgress({ indexed: 0, total: 0, currentFile: "", folderName });
}

// N'est appelée qu'après le rendu final (voir scheduleStudioFolderTreeRender) —
// jamais directement à la résolution d'un import, pour éviter tout écran
// "vide" entre la fin du scan et l'apparition réelle du dossier dans l'arbre.
function hideStudioImportProgress() {
    if (studioImportsInFlight > 0) return; // un autre import est encore en cours
    const box = document.getElementById("studioImportProgress");
    if (box) box.style.display = "none";
}

if (window.electronAPI && typeof window.electronAPI.onScanProgress === "function") {
    window.electronAPI.onScanProgress((progress) => updateStudioImportProgress(progress));
}

/* =========================================================
    PIED DE PAGE (footer) : lien externe + compteur catalogue
========================================================= */

const footerSiteLink = document.getElementById("footerSiteLink");
if (footerSiteLink) {
    footerSiteLink.addEventListener("click", (e) => {
        e.preventDefault();
        if (window.electronAPI && typeof window.electronAPI.openExternalLink === "function") {
            window.electronAPI.openExternalLink(footerSiteLink.href);
        }
    });
}

// Récupère le total du catalogue et, si un filtre de la grille est actif
// (note minimale ou statut), affiche "affichées / total" plutôt que le
// simple total. Appelée au chargement, après chaque import, et après
// chaque changement de filtre dans GridManager.
async function updateFooterCatalogStats() {
    const el = document.getElementById("footerCatalogStats");
    if (!el) return;

    let totalPhotos = 0;
    if (window.electronAPI && typeof window.electronAPI.getCatalogStats === "function") {
        try {
            const stats = await window.electronAPI.getCatalogStats();
            totalPhotos = stats?.totalPhotos || 0;
        } catch (err) {
            console.error("❌ Erreur récupération des statistiques du catalogue :", err);
        }
    }

    const gm = window.gridManager;
    const filterState = gm?.filterState;
    const filterActive = !!filterState && (filterState.minRating > 0 || filterState.flagFilter !== "all");

    el.textContent = filterActive
        ? `${gm.images.length} affichée(s) / ${totalPhotos} au total`
        : `${totalPhotos} photo${totalPhotos > 1 ? "s" : ""}`;
}
window.updateFooterCatalogStats = updateFooterCatalogStats;

async function openStudioFolder() {
    try {
        if (window.electronAPI && typeof window.electronAPI.selectFolderRecursive === "function") {
            const folderData = await window.electronAPI.selectFolderRecursive();
            if (!folderData || !folderData.path) return;

            if (typeof window.electronAPI.addCatalogFolder === "function") {
                studioImportsInFlight++;
                showStudioImportProgress(folderData.name);
                try {
                    studioFoldersList = await window.electronAPI.addCatalogFolder(folderData);
                } catch (err) {
                    console.error("❌ Erreur lors de l'ajout du dossier au catalogue :", err);
                } finally {
                    studioImportsInFlight--;
                    // Toujours planifié, même en erreur : garantit que le message
                    // d'attente disparaît et ne reste jamais bloqué à l'écran.
                    scheduleStudioFolderTreeRender();
                }
            }
        }
    } catch (err) {
        console.error("❌ Erreur lors de l'ouverture du dossier :", err);
    }
}

async function loadSavedStudioFolders() {
    try {
        if (window.electronAPI && typeof window.electronAPI.getCatalog === "function") {
            studioFoldersList = await window.electronAPI.getCatalog();
            renderStudioFolderTree();
        }
    } catch (e) {
        console.error("❌ Erreur de chargement du catalogue SQLite :", e);
    }
}

/* =========================================================
    MODULE PROFILE MANAGER (NP3 / NCP)
========================================================= */

// 🔹 Construit (si besoin) profileImageProcessor avec les retouches et masques
// locaux du Studio désactivés : RetouchManager/MasksManager sont des états
// GLOBAUX (comme MonochromeManager, voir DEFAULT_PICTURE_CONTROL plus haut),
// partagés par toutes les instances ImageProcessor — sans ce verrou, une
// retouche ou un masque peint sur la photo du Studio s'appliquerait aussi ici,
// alors que ce module doit rester strictement indépendant du Studio.
function ensureProfileImageProcessor() {
    if (!profileImageProcessor && typeof ImageProcessor !== "undefined") {
        profileImageProcessor = new ImageProcessor("profilePreviewCanvas");
        profileImageProcessor.enableMasks = false;
        profileImageProcessor.enableRetouches = false;
    }
    return profileImageProcessor;
}

// 🔹 "Aperçu sur cette photo" (Gestionnaire de profils) : activé dès qu'un
// profil est sélectionné/importé (activeProfilePC), désactivé sinon.
function updateApplyProfileButtonState() {
    const btn = document.getElementById("btnPreviewProfileOnPhoto");
    if (btn) btn.disabled = !activeProfilePC;
}

function renderProfilePanel(pc, isNewInstance = false) {
    activeProfilePC = pc;
    updateApplyProfileButtonState();
    if (typeof window.renderPictureControlPanel !== "function") return;

    window.renderPictureControlPanel("profileControlStatus", pc, {
        compact: true,
        extendedNP3: true,
        isNewInstance: isNewInstance,
        onChange: (state) => {
            activeProfilePC = state;
            updateApplyProfileButtonState();
            if (profileImageProcessor) profileImageProcessor.setPictureControl(state);
        },
        // 🔹 Sans ceci, le bouton "Réinitialiser" du composant retombe sur son
        // cache interne (originalPictureControlByContainer), un instantané pris
        // à la dernière instanciation "neuve" du panneau — qui peut très bien
        // être un profil Monochrome (ex. sélection d'un profil importé N&B) et
        // rester coincé indéfiniment. Un vrai profil neutre complet à la place.
        onReset: () => structuredClone(DEFAULT_PICTURE_CONTROL)
    });
}

function renderNp3Library() {
    const container = document.getElementById("np3ListContainerProfiles");
    if (!container) return;

    container.innerHTML = "";

    if (!np3Library || np3Library.length === 0) {
        container.innerHTML = `<p style="color:#888; font-size:12px; font-style:italic; padding:10px 0;">Aucun profil importé</p>`;
        return;
    }

    np3Library.forEach((item, index) => {
        const div = document.createElement("div");
        div.className = "np3-item";
        div.innerHTML = `
            <span style="display:flex; align-items:center; gap:5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:170px;">${window.lucideIconHtml("file", { size: 13 })}${item.name}</span>
            <button class="btn-remove-np3" data-index="${index}" title="Supprimer">${window.lucideIconHtml("x", { size: 13 })}</button>
        `;

        div.onclick = (e) => {
            if (e.target.classList.contains("btn-remove-np3")) return;

            document.querySelectorAll(".np3-item").forEach(el => el.classList.remove("active"));
            div.classList.add("active");

            let pc = item.data?.pictureControl || item.data || {};
            pc.sharpening = pc.sharpening ?? pc.sharpness ?? 0;
            pc.midRangeSharpening = pc.midRangeSharpening ?? 0;

            if (profileImageProcessor) profileImageProcessor.setPictureControl(pc);
            renderProfilePanel(pc, true);
        };

        const btnRemove = div.querySelector(".btn-remove-np3");
        if (btnRemove) {
            btnRemove.onclick = (e) => {
                e.stopPropagation();
                np3Library.splice(index, 1);
                localStorage.setItem("nikon_np3_library", JSON.stringify(np3Library));
                renderNp3Library();
            };
        }

        container.appendChild(div);
    });
}

function pathFileName(filePath) {
    return filePath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, "");
}

/* =========================================================
    CHARGEMENT STUDIO & RENDERER AVEC PERSISTANCE - CORRIGÉ
========================================================= */
/* =========================================================
    CHARGEMENT STUDIO & RENDERER AVEC PERSISTANCE - CORRIGÉ
========================================================= */

async function loadImageInStudio(filePath) {
    if (!filePath) return;

    const myToken = ++currentLoadToken;

    window.currentStudioFilePath = filePath;

    try {
        currentNefFileName = pathFileName(filePath);

        let fileInfo = null;

        if (studioImageCache.has(filePath)) {
            fileInfo = studioImageCache.get(filePath);
        } else {
            if (window.electronAPI && typeof window.electronAPI.readFileDirect === "function") {
                fileInfo = await window.electronAPI.readFileDirect(filePath, studioPreviewMaxWidth);
            }
            if (fileInfo) {
                studioImageCache.set(filePath, fileInfo);
            }
        }

        // Une navigation plus récente a été lancée entre-temps : on abandonne
        // silencieusement ce chargement devenu obsolète, sans toucher à l'affichage.
        if (myToken !== currentLoadToken) return;

        if (!fileInfo) {
            console.error("❌ Impossible de lire le fichier :", filePath);
            return;
        }

        // 🔥 CHARGER LES RÉGLAGES SAUVEGARDÉS (UN SEUL APPEL !)
        const savedSettings = await loadPictureControlSettings(filePath);
        if (myToken !== currentLoadToken) return;

        // 🔹 Retouches (tampon de duplication) : champ dédié à part des
        // réglages Picture Control, rechargé par photo comme eux. Retiré de
        // savedSettings pour ne pas polluer l'objet Picture Control appliqué
        // plus bas (pcData = savedSettings dans la branche suivante).
        if (typeof window.RetouchManager !== "undefined") {
            const savedRetouches = Array.isArray(savedSettings?.retouches) ? savedSettings.retouches : [];
            if (savedSettings && "retouches" in savedSettings) delete savedSettings.retouches;
            window.RetouchManager.loadRetouches(savedRetouches);
            if (window.retouchCanvasController) window.retouchCanvasController.cancelMode();
            if (typeof window.renderRetouchPanel === "function") window.renderRetouchPanel();
        }

        // 🔹 Simulation Pellicule : même principe que les retouches, champ dédié
        // retiré de savedSettings pour ne pas polluer l'objet Picture Control
        // (pcData = savedSettings dans la branche suivante).
        if (window.imageProcessor && typeof window.imageProcessor.setFilmSettings === "function") {
            const savedFilmSettings = (savedSettings && savedSettings.filmSettings) || {};
            if (savedSettings && "filmSettings" in savedSettings) delete savedSettings.filmSettings;
            window.imageProcessor.setFilmSettings(savedFilmSettings);
            if (typeof window.renderFilmPanel === "function") window.renderFilmPanel();
        }

        // 🔹 Module Monochrome dédié : même principe, champ dédié retiré de
        // savedSettings pour ne pas polluer l'objet Picture Control. Repart
        // toujours de zéro (pas d'historique conservé d'une photo à l'autre),
        // comme RetouchManager.loadRetouches().
        if (typeof window.MonochromeManager !== "undefined") {
            const savedMonochromeStudio = (savedSettings && savedSettings.monochromeStudio) || {};
            if (savedSettings && "monochromeStudio" in savedSettings) delete savedSettings.monochromeStudio;
            window.MonochromeManager.loadSettings(savedMonochromeStudio);
            if (typeof window.renderMonochromePanel === "function") window.renderMonochromePanel();
        }

        let pcData = {};

        if (savedSettings && Object.keys(savedSettings).length > 0) {
            pcData = savedSettings;
            console.log("📂 Utilisation des réglages sauvegardés");
            
            // 🔥 APPLIQUER LES RÉGLAGES AUX CURSEURS
          // Dans loadImageInStudio, remplace :
if (typeof applySettingsToSliders === "function") {
    applySettingsToSliders(savedSettings);
} else if (typeof window.applySettingsToSliders === "function") {
    window.applySettingsToSliders(savedSettings);
} else {
    // Fallback...
}

// Par ceci (plus simple) :
if (typeof window.applySettingsToSliders === "function") {
    window.applySettingsToSliders(savedSettings);
} else {
    // Fallback manuel
    console.warn("⚠️ window.applySettingsToSliders non disponible, fallback manuel");
    const sliders = document.querySelectorAll('input[type="range"]');
    sliders.forEach(slider => {
        const key = slider.id || slider.name;
        if (key && savedSettings[key] !== undefined) {
            slider.value = savedSettings[key];
            const display = document.getElementById(`${key}-value`);
            if (display) {
                display.textContent = savedSettings[key];
            }
        }
    });
}
            
            // 🔥 METTRE À JOUR LE PANNEAU PICTURE CONTROL
            if (typeof window.updatePictureControl === "function") {
                window.updatePictureControl({
                    pictureControl: savedSettings,
                    isNewFile: false
                }, true);
            }
            
            console.log("✅ Réglages appliqués à l'interface");
        } else {
            pcData = fileInfo.pictureControl || fileInfo.pc || {};
            pcData.sharpening = pcData.sharpening ?? pcData.sharpness ?? 3.25;
            pcData.midRangeSharpening = pcData.midRangeSharpening ?? 1.0;
            
            // Réinitialiser les curseurs à 0
            const sliders = document.querySelectorAll('input[type="range"]');
            sliders.forEach(slider => {
                slider.value = 0;
                const display = document.getElementById(`${slider.id}-value`);
                if (display) {
                    display.textContent = '0';
                }
            });
        }

        let rawSrc = fileInfo.preview || fileInfo.filePath || fileInfo.path;
        let imageSrc = "";

        if (rawSrc) {
            if (rawSrc.startsWith("data:")) {
                imageSrc = rawSrc;
            } else if (/^[A-Za-z0-9+/=]+$/.test(rawSrc.toString().trim().substring(0, 100))) {
                imageSrc = `data:image/jpeg;base64,${rawSrc.toString().trim()}`;
            } else {
                const formattedPath = rawSrc.toString().replace(/\\/g, "/");
                imageSrc = formattedPath.startsWith("/") ? `file://${formattedPath}` : `file:///${formattedPath}`;
            }
        }

  // ============================================================
// 🔥 AFFICHER LES EXIF AVEC SHUTTER COUNT
// ============================================================
if (fileInfo && (fileInfo.make || fileInfo.model || fileInfo.iso)) {
    // Utiliser updateExifBarFromDb avec les données de fileInfo
    updateExifBarFromDb({
        make: fileInfo.make || null,
        model: fileInfo.model || null,
        lens: fileInfo.lens || fileInfo.lensModel || null,
        iso: fileInfo.iso || null,
        aperture: fileInfo.aperture || null,
        focal_length: fileInfo.focalLength || null,
        shutter_speed: fileInfo.shutterSpeed || null,
        exposure_compensation: fileInfo.exposureCompensation || null,
        white_balance: fileInfo.whiteBalance || null,
        date_time_original: fileInfo.dateTimeOriginal || null,
        shutter_count: fileInfo.shutterCount || null  // 🔥 NOUVEAU
    });
    console.log("✅ EXIF affichées depuis fileInfo avec shutterCount:", fileInfo.shutterCount);
} else {
    // Fallback sur l'ancienne méthode
    if (typeof window.updateExif === "function") {
        window.updateExif(fileInfo);
    }
}

        if (imageSrc && window.imageProcessor) {
            if (typeof window.imageProcessor.clear === "function") {
                window.imageProcessor.clear();
            }

            await window.imageProcessor.load(
                imageSrc,
                fileInfo.orientation || 1,
                {
                    lens: fileInfo.lens,
                    focalLength: fileInfo.rawFocalLength || fileInfo.focal,
                    aperture: fileInfo.rawAperture || fileInfo.aperture,
                    // 🔹 Fabricant du boîtier : le champ EXIF "Lens" de secours (utilisé
                    // quand LensModel est absent, cas courant pour certains couples
                    // boîtier/objectif Nikon) est souvent générique ("18-55mm
                    // f/3.5-5.6", sans marque) — plusieurs fabricants partagent des
                    // noms d'objectif quasi identiques dans la base Lensfun (Canon/
                    // Samsung/Sony/Nikon ont chacun un "18-55mm f/3.5-5.6"). Sans
                    // filtrer par fabricant d'abord, la recherche peut se tromper de
                    // marque — voir LensDatabaseParser.findLensProfile.
                    make: fileInfo.make
                }
            );

            if (myToken !== currentLoadToken) return;

            // 🔹 Chemin de la photo pour le zoom pleine résolution (voir
            // ImageProcessor.ensureFullResolutionLoaded / DisplayCanvas.onRequestFullRes).
            window.imageProcessor.currentFilePath = filePath;

            // 🔥 APPLIQUER LES RÉGLAGES CHARGÉS
            window.imageProcessor.setPictureControl(pcData);
        }

        // 🔹 Nouvelle photo = nouvel objectif potentiel (currentLensInfo vient
        // d'être mis à jour par load()) : rafraîchit tout de suite l'état
        // affiché (case à cocher + texte de statut), pendant que la résolution
        // async du profil (voir _refreshLensProfile) se termine en arrière-plan.
        if (typeof window.updateLensCorrectionStatus === "function") window.updateLensCorrectionStatus();

        if (typeof window.updatePictureControl === "function") {
            window.updatePictureControl({
                pictureControl: pcData,
                lens: fileInfo.lens || "Objectif non renseigné",
                isNewFile: true
            }, true);
        }

        window.currentPictureControl = pcData;

        if (typeof window.switchToView === "function") {
            window.switchToView("view-studio");
        }

        // 🔹 CORRECTIF : switchToView ne fait que choisir entre Studio/Profils/Impression,
        // il ignore le sous-mode Photo unique / Galerie interne au Studio. Sans ceci,
        // charger une photo (clic dans l'arbre, flèches...) pendant qu'on est en mode
        // Galerie la charge bien en mémoire mais laisse la grille affichée à l'écran —
        // l'utilisateur a l'impression que la photo "ne s'affiche pas".
        if (window.gridManager && typeof window.gridManager.switchMode === "function") {
            window.gridManager.switchMode("single");
        }

        // 🔥 PARTAGER L'IMAGE AVEC PrintManager AVEC LES RÉGLAGES
        if (window.printManager && fileInfo) {
            const pcForPrint = savedSettings || pcData || {};
            try {
                window.printManager.setImage(filePath, pcForPrint);
                console.log("✅ Image partagée avec PrintManager avec réglages:", Object.keys(pcForPrint));
            } catch (pmErr) {
                console.warn("⚠️ Erreur partage avec PrintManager:", pmErr);
            }
        }

        // 🔹 ShutterCount en tâche de fond : appelé APRÈS l'affichage de la photo et
        // des EXIF de base, sans await, pour ne jamais retarder la navigation.
        fetchShutterCountInBackground(filePath, fileInfo);

        prefetchAdjacentImages(filePath);

        // 🔹 NOUVEAU : synchronise la surbrillance dans l'arbre "Dossiers Photos",
        // même quand le chargement vient des flèches de navigation et non d'un clic.
        highlightSelectedTreeItem(filePath);

        // 🔹 NOUVEAU : recharge la note/le statut de la photo affichée (peut avoir
        // été modifié depuis la Galerie entre-temps).
        refreshStudioRatingUI(filePath);

    } catch (err) {
        console.error("❌ Erreur lors du chargement dans le Studio :", err);
    }
}
window.loadImageInStudio = loadImageInStudio;

     

     


function prefetchAdjacentImages(currentPath) {
    if (!window.gridManager || !window.gridManager.images || window.gridManager.images.length === 0) return;
    const images = window.gridManager.images;

    let currentIndex = images.findIndex(img => img.path === currentPath);
    if (currentIndex === -1) return;

    const prevIndex = (currentIndex - 1 + images.length) % images.length;
    const nextIndex = (currentIndex + 1) % images.length;

    [images[prevIndex].path, images[nextIndex].path].forEach(async (path) => {
        if (path && !studioImageCache.has(path)) {
            try {
                if (window.electronAPI && typeof window.electronAPI.readFileDirect === "function") {
                    const info = await window.electronAPI.readFileDirect(path);
                    if (info) {
                        studioImageCache.set(path, info);
                    }
                }
            } catch (e) {}
        }
    });
}

/* =========================================================
    MODULE EXPORTATION
========================================================= */

/**
 * 🔹 Affiche/masque un indicateur simple pendant le décodage pleine résolution
 * (peut prendre plusieurs secondes sur un gros RAW).
 */
function showRawDecodingIndicator(show) {
    let el = document.getElementById("rawDecodingIndicator");

    if (show) {
        if (!el) {
            el = document.createElement("div");
            el.id = "rawDecodingIndicator";
            el.innerHTML = `${window.lucideIconHtml ? window.lucideIconHtml("loader-circle", { size: 14, className: "icon-spin" }) : ""} Décodage RAW en cours...`;
            el.style.cssText = `
                position: fixed;
                top: 16px;
                left: 50%;
                transform: translateX(-50%);
                background: #222;
                color: #fff;
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 13px;
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 6px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            `;
            document.body.appendChild(el);
        }
        el.style.display = "block";
    } else if (el) {
        el.style.display = "none";
    }
}

/**
 * 🔹 Encadrement (cadre blanc/noir, export ET impression) : préférence GLOBALE
 * persistée via electron-store (pas par photo, voir main.js get/save-frame-settings).
 * Charge l'état sauvegardé dans les contrôles de la modale d'export, et
 * persiste immédiatement tout changement (retrouvé tel quel côté Impression,
 * voir PrintManager.initFramePrintControls dans PrintManager.js).
 */
async function initExportFrameControls() {
    const enabledEl = document.getElementById("expFrameEnabled");
    const colorEl = document.getElementById("expFrameColor");
    const widthEl = document.getElementById("expFrameWidth");
    const widthLabel = document.getElementById("expFrameWidthVal");
    const optionsBlock = document.getElementById("expFrameOptions");
    if (!enabledEl || !colorEl || !widthEl) return;

    const applyToUi = (settings) => {
        enabledEl.checked = !!settings.enabled;
        colorEl.value = settings.color === "black" ? "black" : "white";
        widthEl.value = settings.widthPercent ?? 5;
        if (widthLabel) widthLabel.textContent = `${widthEl.value}%`;
        if (optionsBlock) optionsBlock.style.display = enabledEl.checked ? "flex" : "none";
        if (optionsBlock) optionsBlock.style.flexDirection = "column";
    };

    if (window.electronAPI && typeof window.electronAPI.getFrameSettings === "function") {
        try {
            const settings = await window.electronAPI.getFrameSettings();
            applyToUi(settings || { enabled: false, color: "white", widthPercent: 5 });
        } catch (err) {
            console.error("❌ Erreur chargement réglages cadre :", err);
        }
    }

    const persist = () => {
        if (optionsBlock) optionsBlock.style.display = enabledEl.checked ? "flex" : "none";
        if (widthLabel) widthLabel.textContent = `${widthEl.value}%`;
        if (window.electronAPI && typeof window.electronAPI.saveFrameSettings === "function") {
            window.electronAPI.saveFrameSettings({
                enabled: enabledEl.checked,
                color: colorEl.value,
                widthPercent: parseFloat(widthEl.value) || 0
            });
        }
    };

    enabledEl.addEventListener("change", persist);
    colorEl.addEventListener("change", persist);
    widthEl.addEventListener("input", persist);
}

/**
 * 🔹 Espace colorimétrique (Partie 4) : pré-remplit le sélecteur de la modale
 * d'export avec le réglage global par défaut (voir Fichier > Paramètres),
 * modifiable ensuite pour CET export uniquement (pas de re-sauvegarde ici).
 */
async function refreshExportColorSpaceDefault() {
    const select = document.getElementById("expColorSpace");
    if (!select || !window.electronAPI || typeof window.electronAPI.getDefaultColorSpace !== "function") return;
    const value = await window.electronAPI.getDefaultColorSpace();
    select.value = value || "srgb";
}
window.refreshExportColorSpaceDefault = refreshExportColorSpaceDefault;

function initExportModal() {
    const modal = document.getElementById("exportModal");
    const btnBrowse = document.getElementById("btnBrowseExpFolder");
    const folderInput = document.getElementById("expFolderPath");
    const qualitySlider = document.getElementById("expQuality");
    const qualityLabel = document.getElementById("expQualityVal");
    const btnCancel = document.getElementById("btnCancelExport");
    const btnConfirm = document.getElementById("btnConfirmExport");

    if (qualitySlider && qualityLabel) {
        qualitySlider.oninput = (e) => {
            qualityLabel.textContent = `${e.target.value}%`;
        };
    }

    // 🔹 Encadrement : préférence GLOBALE (electron-store), pas par photo —
    // partagée avec le panneau Impression (voir PrintManager.js). Chargée au
    // démarrage puis tenue à jour localement ; persistée à chaque changement.
    initExportFrameControls();
    refreshExportColorSpaceDefault();

    if (btnBrowse && folderInput) {
        btnBrowse.onclick = async () => {
            if (window.electronAPI && typeof window.electronAPI.selectExportFolder === "function") {
                const folder = await window.electronAPI.selectExportFolder();
                if (folder) folderInput.value = folder;
            }
        };
    }

    if (btnCancel && modal) {
        btnCancel.onclick = () => {
            modal.style.display = "none";
        };
    }

    if (btnConfirm && modal) {
        btnConfirm.onclick = async () => {
            const frameOptions = {
                enabled: document.getElementById("expFrameEnabled")?.checked || false,
                color: document.getElementById("expFrameColor")?.value || "white",
                widthPercent: parseFloat(document.getElementById("expFrameWidth")?.value) || 0
            };

            const config = {
                folder: folderInput ? folderInput.value : "",
                format: document.getElementById("expFormat")?.value || "image/jpeg",
                quality: qualitySlider ? parseFloat(qualitySlider.value) / 100 : 0.9,
                colorSpace: document.getElementById("expColorSpace")?.value || "srgb",
                width: parseInt(document.getElementById("expWidth")?.value) || null,
                height: parseInt(document.getElementById("expHeight")?.value) || null,
                dpi: parseInt(document.getElementById("expDpi")?.value) || 300,
                stripExif: document.getElementById("expStripExif")?.checked || false,
                frame: frameOptions
            };

            if (!config.folder) {
                alert("Veuillez choisir un dossier de destination.");
                return;
            }

            modal.style.display = "none";

            const singleContainer = document.getElementById("singleImageContainer");
            const isSingleMode = singleContainer && singleContainer.style.display !== "none";

            try {
                if (isSingleMode) {
                    if (!window.imageProcessor) {
                        alert("❌ Aucune image chargée à exporter");
                        return;
                    }

                    showRawDecodingIndicator(true);
                    let dataUrl;
                    try {
                        dataUrl = window.imageProcessor.exportFullResolution ?
                            await window.imageProcessor.exportFullResolution(window.currentStudioFilePath, config.quality, config.format, frameOptions) :
                            null;
                    } finally {
                        showRawDecodingIndicator(false);
                    }

                    if (!dataUrl) {
                        alert("❌ Impossible de générer l'export. Aucune image chargée ou erreur de traitement.");
                        return;
                    }

                    const base64Data = dataUrl.split(",")[1];

                    const saveFunc = window.electronAPI?.saveImageFile || window.electronAPI?.saveJPEG;
                    if (saveFunc) {
                        const res = await saveFunc({
                            defaultName: currentNefFileName || "export-photo",
                            base64Data: base64Data,
                            exportConfig: config
                        });
                        if (res?.success) {
                            alert(res.iccWarning ? `✅ Export réussi ! ⚠️ ${res.iccWarning}` : "✅ Export réussi !");
                        } else {
                            alert(`❌ Erreur d'export : ${res?.error || "Échec inconnu"}`);
                        }
                    }
                } else if (window.gridManager && window.gridManager.selectedIds.size > 0) {
                    await window.gridManager.exportSelectedImages(config);
                }
            } catch (err) {
                console.error("❌ Erreur globale lors de l'export :", err);
                alert(`❌ Erreur lors de l'export : ${err.message || err}`);
            }
        };
    }
}

/* =========================================================
    PROGRAMMES EXTERNES ("Ouvrir avec...")
========================================================= */

function truncatePath(p, maxLen = 34) {
    if (!p || p.length <= maxLen) return p || "";
    return "..." + p.slice(-(maxLen - 3));
}

function renderExternalProgramsList(programs) {
    const container = document.getElementById("externalProgramsList");
    if (!container) return;

    if (!programs || programs.length === 0) {
        container.innerHTML = `<p style="color:#888; font-size:12px; font-style:italic; margin:0;">Aucun programme configuré.</p>`;
        return;
    }

    container.innerHTML = programs.map(p => `
        <div style="display:flex; align-items:center; gap:8px; background:#1e1f22; border:1px solid #35373c; border-radius:4px; padding:6px 8px;">
            <div style="flex:1; overflow:hidden;">
                <div style="font-size:12px; font-weight:bold;">${p.name}</div>
                <div style="font-size:10px; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${p.execPath}">${truncatePath(p.execPath)}</div>
            </div>
            <button class="btn-remove-external-program" data-id="${p.id}" title="Supprimer" style="background:transparent; border:none; color:#aaa; cursor:pointer;">${window.lucideIconHtml("x", { size: 14 })}</button>
        </div>
    `).join("");

    container.querySelectorAll(".btn-remove-external-program").forEach(btn => {
        btn.addEventListener("click", async () => {
            const updated = programs.filter(p => p.id !== btn.dataset.id);
            await window.electronAPI.saveExternalPrograms(updated);
            renderExternalProgramsList(updated);
        });
    });
}

async function refreshExternalProgramsList() {
    if (!window.electronAPI || typeof window.electronAPI.getExternalPrograms !== "function") return [];
    const programs = await window.electronAPI.getExternalPrograms();
    renderExternalProgramsList(programs);
    return programs;
}

/**
 * 🔹 Modale "Paramètres" : tableau de réglages extensible en onglets (voir
 * renderer/index.html #settingsModal). Pour l'instant : Programmes externes
 * (déplacé depuis son ancienne modale dédiée) + Espace colorimétrique par
 * défaut (export). D'autres catégories pourront s'ajouter comme de nouveaux
 * onglets sans toucher à la structure existante.
 */
function selectSettingsTab(tab) {
    const validTab = ["external-programs", "color-management"].includes(tab) ? tab : "external-programs";

    document.querySelectorAll(".settings-tab-btn").forEach(btn => {
        const isActive = btn.dataset.tab === validTab;
        btn.style.color = isActive ? "#fff" : "#aaa";
        btn.style.borderBottomColor = isActive ? "#5865f2" : "transparent";
    });

    document.querySelectorAll(".settings-tab-panel").forEach(panel => {
        panel.style.display = (panel.id === `settingsTab-${validTab}`) ? "block" : "none";
    });
}

async function refreshDefaultColorSpaceSelect() {
    const select = document.getElementById("settingsDefaultColorSpace");
    if (!select || !window.electronAPI || typeof window.electronAPI.getDefaultColorSpace !== "function") return;

    const value = await window.electronAPI.getDefaultColorSpace();
    select.value = value || "srgb";

    // 🔹 ProPhoto RGB est généré automatiquement (voir services/iccProfileBuilder.js) :
    // ce contrôle ne sert plus qu'à détecter un échec d'écriture disque, très rare.
    const warningEl = document.getElementById("settingsColorSpaceWarning");
    if (warningEl && typeof window.electronAPI.checkIccProfiles === "function") {
        const status = await window.electronAPI.checkIccProfiles();
        if (value === "prophoto" && !status?.prophoto) {
            warningEl.textContent = "⚠️ Impossible de générer le profil ICC ProPhoto RGB (erreur disque ?) : les exports retomberont automatiquement en sRGB.";
            warningEl.style.display = "block";
        } else {
            warningEl.style.display = "none";
        }
    }
}

function initSettingsModal() {
    const modal = document.getElementById("settingsModal");
    const btnClose = document.getElementById("btnCloseSettingsModal");
    const btnAdd = document.getElementById("btnAddExternalProgram");
    const addRow = document.getElementById("externalProgramAddRow");
    const nameInput = document.getElementById("externalProgramNameInput");
    const btnBrowse = document.getElementById("btnBrowseExternalProgram");
    const btnCancelAdd = document.getElementById("btnCancelAddExternalProgram");
    const colorSpaceSelect = document.getElementById("settingsDefaultColorSpace");

    if (btnClose && modal) {
        btnClose.onclick = () => { modal.style.display = "none"; };
    }

    document.querySelectorAll(".settings-tab-btn").forEach(btn => {
        btn.onclick = () => selectSettingsTab(btn.dataset.tab);
    });

    if (btnAdd && addRow) {
        btnAdd.onclick = () => {
            addRow.style.display = "flex";
            btnAdd.style.display = "none";
            if (nameInput) { nameInput.value = ""; nameInput.focus(); }
        };
    }

    if (btnCancelAdd && addRow && btnAdd) {
        btnCancelAdd.onclick = () => {
            addRow.style.display = "none";
            btnAdd.style.display = "inline-flex";
        };
    }

    if (btnBrowse) {
        btnBrowse.onclick = async () => {
            const name = (nameInput?.value || "").trim();
            if (!name) {
                alert("Indique un nom pour ce programme.");
                return;
            }
            if (!window.electronAPI || typeof window.electronAPI.browseExecutable !== "function") return;

            const execPath = await window.electronAPI.browseExecutable();
            if (!execPath) return; // annulé

            const programs = await window.electronAPI.getExternalPrograms();
            const updated = [...programs, { id: `ext_${Date.now()}`, name, execPath }];
            await window.electronAPI.saveExternalPrograms(updated);
            renderExternalProgramsList(updated);

            addRow.style.display = "none";
            if (btnAdd) btnAdd.style.display = "inline-flex";
        };
    }

    if (colorSpaceSelect) {
        colorSpaceSelect.onchange = async () => {
            if (window.electronAPI && typeof window.electronAPI.saveDefaultColorSpace === "function") {
                await window.electronAPI.saveDefaultColorSpace(colorSpaceSelect.value);
            }
            refreshDefaultColorSpaceSelect();
        };
    }

    window.openSettingsModal = async (initialTab = "external-programs") => {
        if (!modal) return;
        if (addRow) addRow.style.display = "none";
        if (btnAdd) btnAdd.style.display = "inline-flex";
        await refreshExternalProgramsList();
        await refreshDefaultColorSpaceSelect();
        selectSettingsTab(initialTab);
        modal.style.display = "flex";
    };

    // 🔹 "Programmes externes" (barre du haut, garde son propre accès direct — voir
    // Partie 3) ouvre la MÊME modale Paramètres, juste sur cet onglet.
    window.openExternalProgramsModal = () => window.openSettingsModal("external-programs");
}

function closeOpenWithDropdown() {
    const dropdown = document.getElementById("openWithDropdown");
    if (dropdown) dropdown.style.display = "none";
}

function showOpenWithIndicator(show) {
    let el = document.getElementById("openWithIndicator");

    if (show) {
        if (!el) {
            el = document.createElement("div");
            el.id = "openWithIndicator";
            el.innerHTML = `${window.lucideIconHtml ? window.lucideIconHtml("loader-circle", { size: 14, className: "icon-spin" }) : ""} Génération et ouverture...`;
            el.style.cssText = `
                position: fixed;
                top: 16px;
                left: 50%;
                transform: translateX(-50%);
                background: #222;
                color: #fff;
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 13px;
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 6px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            `;
            document.body.appendChild(el);
        }
        el.style.display = "flex";
    } else if (el) {
        el.style.display = "none";
    }
}

async function runOpenInExternalProgram(program) {
    if (!window.currentStudioFilePath || !window.imageProcessor) {
        alert("Aucune photo chargée.");
        return;
    }
    if (!window.electronAPI || typeof window.electronAPI.openInExternalProgram !== "function") return;

    showOpenWithIndicator(true);
    try {
        const dataUrl = typeof window.imageProcessor.exportProcessedTiff === "function"
            ? await window.imageProcessor.exportProcessedTiff(window.currentStudioFilePath)
            : null;

        if (!dataUrl) {
            alert("❌ Impossible de générer le TIFF pour cette photo.");
            return;
        }

        const result = await window.electronAPI.openInExternalProgram({
            imageDataUrl: dataUrl,
            originalFilePath: window.currentStudioFilePath,
            programExecPath: program.execPath,
            programName: program.name
        });

        if (!result || !result.success) {
            alert(`❌ Erreur : ${result?.error || "Échec inconnu"}`);
            return;
        }

        // 🔹 Indexe uniquement le nouveau TIFF (pas un rescan complet du dossier,
        // trop lent) pour qu'il apparaisse dans l'arbre sans réimport manuel.
        // Ne fait rien si la photo n'appartient à aucun dossier suivi par le
        // catalogue (arbre inchangé, comportement identique à avant).
        if (window.electronAPI && typeof window.electronAPI.addSingleFileToCatalog === "function") {
            const updatedCatalog = await window.electronAPI.addSingleFileToCatalog(result.generatedPath);
            if (updatedCatalog) {
                studioFoldersList = updatedCatalog;
            }
        }
        if (typeof window.renderStudioFolderTree === "function") {
            window.renderStudioFolderTree();
        }
    } catch (err) {
        console.error("❌ Erreur Ouvrir avec:", err);
        alert(`❌ Erreur : ${err.message || err}`);
    } finally {
        showOpenWithIndicator(false);
    }
}

function initOpenWithButton() {
    const btn = document.getElementById("btnOpenWith");
    const dropdown = document.getElementById("openWithDropdown");
    if (!btn || !dropdown) return;

    btn.addEventListener("click", async (e) => {
        e.stopPropagation();

        if (dropdown.style.display === "block") {
            closeOpenWithDropdown();
            return;
        }

        const programs = (window.electronAPI && typeof window.electronAPI.getExternalPrograms === "function")
            ? await window.electronAPI.getExternalPrograms()
            : [];

        if (!programs.length) {
            dropdown.innerHTML = `<p style="font-size:11px; color:#aaa; margin:4px; max-width:200px;">Aucun programme configuré. Rends-toi dans "Fichier" → "Paramètres" pour en déclarer un.</p>`;
        } else {
            dropdown.innerHTML = programs.map(p => `
                <button class="open-with-item" data-id="${p.id}" style="display:block; width:100%; text-align:left; background:transparent; border:none; color:#e8eaed; padding:6px 8px; border-radius:4px; cursor:pointer; font-size:12px;">${p.name}</button>
            `).join("");

            dropdown.querySelectorAll(".open-with-item").forEach(item => {
                item.addEventListener("mouseenter", () => { item.style.background = "#35373c"; });
                item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
                item.addEventListener("click", () => {
                    closeOpenWithDropdown();
                    const program = programs.find(p => p.id === item.dataset.id);
                    if (program) runOpenInExternalProgram(program);
                });
            });
        }

        dropdown.style.display = "block";
    });

    document.addEventListener("click", (e) => {
        if (dropdown.style.display === "block" && !dropdown.contains(e.target) && e.target !== btn) {
            closeOpenWithDropdown();
        }
    });
}

/* =========================================================
    INITIALISATION ET EVENEMENTS IHM
========================================================= */

async function switchToView(targetViewId) {
    const ALL_VIEW_IDS = ["view-studio", "view-profiles", "view-print"];

    ALL_VIEW_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.removeProperty("display");
        if (id === targetViewId) {
            el.classList.remove("view-hidden");
            el.classList.add("view-active");
            el.style.display = "flex";
        } else {
            el.classList.remove("view-active");
            el.style.display = "none";
        }
    });

    const headerStudio = document.getElementById("header-studio-actions");
    const headerProfiles = document.getElementById("header-profile-actions");
    const headerPrint = document.getElementById("header-print-actions");

    if (headerStudio) headerStudio.style.display = (targetViewId === "view-studio") ? "flex" : "none";
    if (headerProfiles) headerProfiles.style.display = (targetViewId === "view-profiles") ? "flex" : "none";
    if (headerPrint) headerPrint.style.display = (targetViewId === "view-print") ? "flex" : "none";

    if (targetViewId === "view-print") {
        if (typeof window.renderPrintPreview === "function") {
            window.renderPrintPreview();
        }
    }

    if (targetViewId === "view-profiles") {
        ensureProfileImageProcessor();

        const pcToShow = activeProfilePC || window.imageProcessor?.pictureControl || null;
        if (pcToShow) {
            if (profileImageProcessor) profileImageProcessor.setPictureControl(pcToShow);
            renderProfilePanel(pcToShow, true);
        }

        renderNp3Library();
    }
}
window.switchToView = switchToView;

function updateStudioRatingUI(status) {
    const stars = document.querySelectorAll("#ratingStars .star");
    const rating = (status && status.rating) || 0;
    stars.forEach((starEl) => {
        const value = parseInt(starEl.dataset.value, 10);
        const filled = value <= rating;
        starEl.classList.toggle("filled", filled);
        starEl.innerHTML = window.lucideIconHtml("star", { size: 18, filled });
    });

    const flag = (status && status.flag) || null;
    const btnValidated = document.getElementById("btnFlagValidated");
    const btnRejected = document.getElementById("btnFlagRejected");
    if (btnValidated) btnValidated.classList.toggle("active", flag === "validated");
    if (btnRejected) btnRejected.classList.toggle("active", flag === "rejected");
}

async function refreshStudioRatingUI(filePath) {
    if (!filePath || !window.electronAPI || typeof window.electronAPI.getPhotosStatus !== "function") {
        updateStudioRatingUI(null);
        return;
    }
    try {
        const result = await window.electronAPI.getPhotosStatus([filePath]);
        updateStudioRatingUI(result ? result[filePath] : null);
    } catch (err) {
        console.error("❌ Erreur récupération note/statut de la photo:", err);
        updateStudioRatingUI(null);
    }
}
window.refreshStudioRatingUI = refreshStudioRatingUI;

function initRatingBar() {
    const stars = Array.from(document.querySelectorAll("#ratingStars .star"));
    const btnValidated = document.getElementById("btnFlagValidated");
    const btnRejected = document.getElementById("btnFlagRejected");

    stars.forEach((starEl) => {
        starEl.addEventListener("click", async () => {
            const filePath = window.currentStudioFilePath;
            if (!filePath || !window.electronAPI) return;

            const clickedValue = parseInt(starEl.dataset.value, 10);
            const currentRating = stars.filter((s) => s.classList.contains("filled")).length;
            const newRating = currentRating === clickedValue ? 0 : clickedValue;

            updateStudioRatingUI({ rating: newRating, flag: btnValidated?.classList.contains("active") ? "validated" : (btnRejected?.classList.contains("active") ? "rejected" : null) });

            if (typeof window.electronAPI.setPhotoRating === "function") {
                await window.electronAPI.setPhotoRating(filePath, newRating);
            }
        });
    });

    if (btnValidated) {
        btnValidated.addEventListener("click", async () => {
            const filePath = window.currentStudioFilePath;
            if (!filePath || !window.electronAPI) return;
            const newFlag = btnValidated.classList.contains("active") ? null : "validated";
            btnValidated.classList.toggle("active", newFlag === "validated");
            btnRejected?.classList.remove("active");
            if (typeof window.electronAPI.setPhotoFlag === "function") {
                await window.electronAPI.setPhotoFlag(filePath, newFlag);
            }
        });
    }

    if (btnRejected) {
        btnRejected.addEventListener("click", async () => {
            const filePath = window.currentStudioFilePath;
            if (!filePath || !window.electronAPI) return;
            const newFlag = btnRejected.classList.contains("active") ? null : "rejected";
            btnRejected.classList.toggle("active", newFlag === "rejected");
            btnValidated?.classList.remove("active");
            if (typeof window.electronAPI.setPhotoFlag === "function") {
                await window.electronAPI.setPhotoFlag(filePath, newFlag);
            }
        });
    }
}

async function exportCatalogBackup() {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.exportBackup();
    if (result && result.success) {
        alert(`Sauvegarde du catalogue créée :\n${result.path}`);
    } else if (result && result.error) {
        alert(`Erreur lors de la sauvegarde du catalogue :\n${result.error}`);
    }
}

async function importCatalogBackup() {
    if (!window.electronAPI) return;
    const confirmed = confirm(
        "Ceci remplacera votre catalogue actuel par la sauvegarde sélectionnée. " +
        "Une copie de sécurité de l'état actuel sera conservée. Continuer ?"
    );
    if (!confirmed) return;

    const result = await window.electronAPI.importBackup();
    if (!result || !result.success) {
        if (result && result.error) {
            alert(`Erreur lors de la restauration du catalogue :\n${result.error}`);
        }
        return;
    }
    // Le rechargement de l'arbre et la confirmation de succès se font via
    // l'événement "catalog:restored" (onCatalogRestored), envoyé par le
    // processus principal une fois l'import réellement terminé.
}

function initButtons() {
    const btnSaveNP3           = document.getElementById("saveNP3");
    const btnExportNCP         = document.getElementById("exportNCP");
    const btnStudioOpenFolder  = document.getElementById("btnStudioOpenFolder");
    const btnImportProfile     = document.getElementById("btnImportProfile");
    const importProfileDropdown = document.getElementById("importProfileDropdown");
    const btnImportProfileRaw = document.getElementById("btnImportProfileRaw");
    const btnPreviewProfileOnPhoto = document.getElementById("btnPreviewProfileOnPhoto");
    const btnViewPrint         = document.getElementById("btnViewPrint");
    const btnViewPrintFromProfile = document.getElementById("btnViewPrintFromProfile");
    const btnBackToStudio      = document.getElementById("btnBackToStudio");

    switchToView("view-studio");
    initRatingBar();

    if (btnViewPrint) {
        btnViewPrint.onclick = () => switchToView("view-print");
    }
    if (btnViewPrintFromProfile) {
        btnViewPrintFromProfile.onclick = () => switchToView("view-print");
    }
    if (btnBackToStudio) {
        btnBackToStudio.onclick = () => switchToView("view-studio");
    }

    const btnFullscreen = document.getElementById("btnFullscreen");
    if (btnFullscreen && window.electronAPI) {
        btnFullscreen.onclick = async () => {
            const isNowFullscreen = await window.electronAPI.toggleFullscreen();
            btnFullscreen.title = isNowFullscreen ? "Quitter le plein écran" : "Plein écran";
        };
    }

    const btnExportCatalogBackup = document.getElementById("btnExportCatalogBackup");
    if (btnExportCatalogBackup && window.electronAPI) {
        btnExportCatalogBackup.onclick = exportCatalogBackup;
    }

    const btnImportCatalogBackup = document.getElementById("btnImportCatalogBackup");
    if (btnImportCatalogBackup && window.electronAPI) {
        btnImportCatalogBackup.onclick = importCatalogBackup;
    }

    if (!window.imageProcessor && typeof ImageProcessor !== "undefined") {
        window.imageProcessor = new ImageProcessor("previewCanvas");
    }

    // 🔥 INTERCEPTER LES MODIFICATIONS POUR SAUVEGARDE AUTOMATIQUE
    if (window.imageProcessor) {
        const debouncedSave = (() => {
            let timeout = null;
            return (filePath) => {
                if (timeout) clearTimeout(timeout);
                timeout = setTimeout(async () => {
                    if (filePath && window.imageProcessor) {
                        const settings = window.imageProcessor.getPictureControl ? 
                            window.imageProcessor.getPictureControl() : 
                            window.imageProcessor.pictureControl;
                        if (settings) {
                            await saveCurrentPictureControlSettings(filePath);
                        }
                    }
                    timeout = null;
                }, 500);
            };
        })();

        const originalSetPictureControl = window.imageProcessor.setPictureControl;
        if (originalSetPictureControl) {
            window.imageProcessor.setPictureControl = function(pc) {
                const result = originalSetPictureControl.call(this, pc);
                if (window.currentStudioFilePath) {
                    debouncedSave(window.currentStudioFilePath);
                }
                return result;
            };
        }
    }

    if (window.imageProcessor && typeof window.initMasksController === "function") {
        window.initMasksController(window.imageProcessor);
    }

    if (window.imageProcessor && typeof window.initRetouchController === "function") {
        window.initRetouchController(window.imageProcessor);
    }

    // 🔹 Gomme couleur (module Monochrome) : try/catch explicite — un contrôleur
    // qui échoue à s'initialiser ici (script manquant, classe indisponible...)
    // ne doit pas interrompre le reste de initButtons().
    if (window.imageProcessor && typeof window.initMonochromeMaskController === "function") {
        try {
            window.initMonochromeMaskController(window.imageProcessor);
        } catch (err) {
            console.error("❌ Erreur initialisation du contrôleur Gomme couleur (Monochrome) :", err);
        }
    }

    if (btnStudioOpenFolder) {
        btnStudioOpenFolder.onclick = openStudioFolder;
    }

    // 🔹 Importe un profil Nikon. formatFilter restreint le sélecteur de fichier
    // à UNE seule extension ("ncp" ou "np3", voir dropdown ci-dessous) ; le code
    // d'import lui-même (loadNP3 IPC) gérait déjà les deux formats en interne,
    // donc pas de logique dupliquée ici, juste le filtre de sélection.
    //
    // 🔹 response.pictureControl (voir main.js/loadNP3) est le VRAI Picture
    // Control reparsé depuis le fichier — pour un .np3/.ncp exporté par cette
    // app (JSON), le round-trip est maintenant complet (isMonochrome et tous
    // les autres réglages sont préservés, voir diagnostic précédent : le bug
    // venait de loadNP3 qui ne renvoyait que les octets bruts, jamais parsés).
    // Un vrai fichier NPC/NP3 binaire Nikon natif n'est pas encore supporté
    // (pictureControl reste alors null) : on le signale explicitement plutôt
    // que d'appliquer silencieusement un profil vide/par défaut.
    const importProfileFile = async (formatFilter) => {
        try {
            const response = await window.electronAPI.loadNP3(formatFilter);
            if (!response) return;

            if (!response.pictureControl) {
                alert("⚠️ Ce fichier n'a pas pu être interprété comme un profil Picture Control " +
                    "(format binaire Nikon natif non pris en charge pour l'instant). Seuls les profils " +
                    "exportés par Pixel RAW (.np3/.ncp) peuvent être ré-importés ici.");
                return;
            }

            const pc = response.pictureControl;
            const name = response.fileName || pc.name || `Profil ${np3Library.length + 1}`;

            np3Library.push({ name: name, data: pc });
            localStorage.setItem("nikon_np3_library", JSON.stringify(np3Library));
            renderNp3Library();

            if (profileImageProcessor) profileImageProcessor.setPictureControl(pc);
            renderProfilePanel(pc, true);
        } catch (err) {
            console.error("❌ Erreur lors de l'importation du profil :", err);
        }
    };

    if (btnImportProfile && importProfileDropdown) {
        btnImportProfile.onclick = (e) => {
            e.stopPropagation();
            importProfileDropdown.style.display = (importProfileDropdown.style.display === "block") ? "none" : "block";
        };

        importProfileDropdown.querySelectorAll(".btn-import-profile-format").forEach(item => {
            item.addEventListener("mouseenter", () => { item.style.background = "#35373c"; });
            item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
            item.addEventListener("click", () => {
                importProfileDropdown.style.display = "none";
                importProfileFile(item.dataset.format);
            });
        });

        document.addEventListener("click", (e) => {
            if (importProfileDropdown.style.display === "block" && !importProfileDropdown.contains(e.target) && e.target !== btnImportProfile) {
                importProfileDropdown.style.display = "none";
            }
        });
    }

    // 🔹 "Importer un RAW" (Gestionnaire de Profils) : charge une photo de test
    // INDÉPENDANTE dans profileImageProcessor, en réutilisant le même mécanisme
    // que l'ouverture de fichier du Studio (openNEF -> readFileDirect), mais
    // SANS jamais toucher à window.imageProcessor ni à window.currentStudioFilePath.
    const importProfileTestRaw = async () => {
        if (!window.electronAPI || typeof window.electronAPI.openNEF !== "function") return;

        try {
            const selection = await window.electronAPI.openNEF();
            if (!selection || !selection.filePath) return;

            if (typeof window.electronAPI.readFileDirect !== "function") return;
            const fileInfo = await window.electronAPI.readFileDirect(selection.filePath, studioPreviewMaxWidth);
            if (!fileInfo) {
                alert("❌ Impossible de lire ce fichier.");
                return;
            }

            let rawSrc = fileInfo.preview || fileInfo.filePath || fileInfo.path;
            let imageSrc = "";
            if (rawSrc) {
                if (rawSrc.startsWith("data:")) {
                    imageSrc = rawSrc;
                } else if (/^[A-Za-z0-9+/=]+$/.test(rawSrc.toString().trim().substring(0, 100))) {
                    imageSrc = `data:image/jpeg;base64,${rawSrc.toString().trim()}`;
                } else {
                    const formattedPath = rawSrc.toString().replace(/\\/g, "/");
                    imageSrc = formattedPath.startsWith("/") ? `file://${formattedPath}` : `file:///${formattedPath}`;
                }
            }
            if (!imageSrc) {
                alert("❌ Impossible de charger l'aperçu de ce fichier.");
                return;
            }

            ensureProfileImageProcessor();
            if (!profileImageProcessor) return;

            await profileImageProcessor.load(imageSrc, fileInfo.orientation || 1, {
                lens: fileInfo.lens,
                focalLength: fileInfo.rawFocalLength || fileInfo.focal,
                aperture: fileInfo.rawAperture || fileInfo.aperture
            });

            // 🔹 Indispensable au zoom pleine résolution (voir DisplayCanvas.
            // ZOOM_FULLRES_THRESHOLD / ImageProcessor.onRequestFullRes) : sans
            // currentFilePath, ensureFullResolutionLoaded() n'a aucun fichier à
            // décoder et abandonne silencieusement — exactement comme le Studio
            // le fait déjà pour window.imageProcessor (voir loadImageInStudio).
            profileImageProcessor.currentFilePath = selection.filePath;

            // 🔹 Cette photo de test devient indépendante : plus jamais écrasée par
            // la photo du Studio lors des retours sur cette vue (voir switchToView).
            profileHasIndependentRaw = true;

            // 🔹 Nouvelle photo de test = repart TOUJOURS d'un profil neutre.
            // NE JAMAIS réappliquer l'ancien activeProfilePC/pictureControl ici :
            // c'était la cause du bug "reste bloqué en Monochrome" — une photo
            // fraîchement importée héritait silencieusement du dernier profil
            // actif (parfois Monochrome) au lieu de partir propre. L'utilisateur
            // choisit ensuite explicitement quel profil appliquer.
            const freshPC = structuredClone(DEFAULT_PICTURE_CONTROL);
            profileImageProcessor.setPictureControl(freshPC);
            renderProfilePanel(freshPC, true);
        } catch (err) {
            console.error("❌ Erreur import RAW (Gestionnaire de Profils) :", err);
        }
    };

    if (btnImportProfileRaw) {
        btnImportProfileRaw.onclick = importProfileTestRaw;
    }

    // 🔹 "Aperçu sur cette photo" : applique le profil sélectionné/importé
    // UNIQUEMENT à profileImageProcessor (photo de test de ce module) — ne
    // touche jamais window.imageProcessor ni ne bascule vers le Studio. Le
    // résultat reste visible et modifiable ici même, sur profilePreviewCanvas.
    updateApplyProfileButtonState();
    if (btnPreviewProfileOnPhoto) {
        btnPreviewProfileOnPhoto.onclick = () => {
            const pc = activeProfilePC || profileImageProcessor?.pictureControl;
            if (!pc || !profileImageProcessor) return;

            profileImageProcessor.setPictureControl(pc);
            profileImageProcessor.render();
        };
    }

    if (btnSaveNP3) {
        btnSaveNP3.onclick = async () => {
            const activePC = activeProfilePC || profileImageProcessor?.pictureControl;
            if (activePC && window.electronAPI) await window.electronAPI.saveNP3File(activePC);
        };
    }

    if (btnExportNCP) {
        btnExportNCP.onclick = async () => {
            const activePC = activeProfilePC || profileImageProcessor?.pictureControl;
            if (activePC && window.electronAPI) await window.electronAPI.exportNCP(activePC);
        };
    }

    const btnRotateLeft   = document.getElementById("btnRotateLeft");
    const btnRotateRight  = document.getElementById("btnRotateRight");
    const btnFlipH        = document.getElementById("btnFlipH");
    const btnFlipV        = document.getElementById("btnFlipV");
    const rangeDegree     = document.getElementById("rangeRotationDegree");
    const inputDegree     = document.getElementById("inputRotationDegree");
    const btnResetRot     = document.getElementById("btnResetRotation");

    let currentTransform = { rotation: 0, flipH: false, flipV: false };

    function applyStudioTransform() {
        if (window.imageProcessor && typeof window.imageProcessor.setTransform === "function") {
            window.imageProcessor.setTransform(currentTransform);
            saveCurrentPhotoSettingsToCatalog();
        }
    }

    if (btnRotateLeft) btnRotateLeft.onclick = () => { currentTransform.rotation -= 90; applyStudioTransform(); };
    if (btnRotateRight) btnRotateRight.onclick = () => { currentTransform.rotation += 90; applyStudioTransform(); };
    if (btnFlipH) btnFlipH.onclick = () => { currentTransform.flipH = !currentTransform.flipH; applyStudioTransform(); };
      if (btnFlipV) btnFlipV.onclick = () => { currentTransform.flipV = !currentTransform.flipV; applyStudioTransform(); };

    if (rangeDegree) {
        rangeDegree.oninput = (e) => {
            const val = parseFloat(e.target.value) || 0;
            const base90 = Math.round(currentTransform.rotation / 90) * 90;
            currentTransform.rotation = base90 + val;
            if (inputDegree) inputDegree.value = val;
            applyStudioTransform();
        };
    }

    if (inputDegree) {
        const handleInput = () => {
            let val = parseFloat(inputDegree.value) || 0;
            if (val > 45) val = 45;
            if (val < -45) val = -45;
            const base90 = Math.round(currentTransform.rotation / 90) * 90;
            currentTransform.rotation = base90 + val;
            if (rangeDegree) rangeDegree.value = val;
            applyStudioTransform();
        };
        inputDegree.oninput = handleInput;
        inputDegree.onchange = handleInput;
    }

    if (btnResetRot) {
        btnResetRot.onclick = () => {
            currentTransform = { rotation: 0, flipH: false, flipV: false };
            if (rangeDegree) rangeDegree.value = 0;
            if (inputDegree) inputDegree.value = 0;
            applyStudioTransform();
        };
    }

    // 🔹 Correction d'objectif : panneau "Orientation & Rotation" (case à
    // cocher externe au panneau Picture Control, voir readState() dans
    // pictureControlPanel.js — lensCorrection y est un simple passe-plat
    // depuis currentPC pour ne jamais être écrasé par un autre curseur).
    const checkLensCorrection  = document.getElementById("checkLensCorrection");
    const lensCorrectionStatus = document.getElementById("lensCorrectionStatus");
    const btnImportLensProfile = document.getElementById("btnImportLensProfile");

    function updateLensCorrectionStatus() {
        if (!lensCorrectionStatus) return;
        const ip = window.imageProcessor;
        const info = ip && ip.currentLensInfo;

        if (checkLensCorrection) checkLensCorrection.checked = !!(ip && ip.pictureControl && ip.pictureControl.lensCorrection);

        if (!info || !info.model || info.model === "Generic") {
            lensCorrectionStatus.textContent = "Aucun objectif détecté dans les métadonnées de cette photo.";
            return;
        }
        if (!ip.lensProfile) {
            lensCorrectionStatus.textContent = `Aucun profil disponible pour "${info.model}".`;
            return;
        }
        const sourceLabel = ip.lensProfile.source === "imported" ? "profil importé" : "base intégrée";
        lensCorrectionStatus.textContent = `Profil trouvé : ${ip.lensProfile.lensName} (${sourceLabel}).`;
    }
    window.updateLensCorrectionStatus = updateLensCorrectionStatus;
    if (window.imageProcessor) {
        window.imageProcessor.onLensProfileResolved = updateLensCorrectionStatus;
        updateLensCorrectionStatus();
    }

    if (checkLensCorrection) {
        checkLensCorrection.onchange = () => {
            if (!window.imageProcessor || !window.imageProcessor.pictureControl) return;
            window.imageProcessor.pictureControl.lensCorrection = checkLensCorrection.checked;
            window.imageProcessor.render();
            saveCurrentPhotoSettingsToCatalog();
        };
    }

    if (btnImportLensProfile) {
        btnImportLensProfile.onclick = async () => {
            if (!window.electronAPI || typeof window.electronAPI.importLensProfile !== "function") return;
            const result = await window.electronAPI.importLensProfile();
            if (!result || !result.success) return;

            // 🔹 Validation : le fichier doit être un XML Lensfun reconnaissable
            // (au moins un <lens> avec de la calibration exploitable), sinon on
            // prévient plutôt que de l'ajouter silencieusement sans effet.
            try {
                const xmlText = await (await fetch(`file:///${result.path.replace(/\\/g, "/")}`)).text();
                const parsed = window.LensDatabaseParser.parseLensfunXml(xmlText, "imported");
                if (!parsed.length) {
                    alert("Ce fichier ne semble pas être un profil XML Lensfun valide (aucun objectif exploitable trouvé).");
                    return;
                }
            } catch (err) {
                console.error("❌ Erreur validation du profil importé :", err);
                alert("Impossible de lire ce fichier.");
                return;
            }

            await window.LensDatabaseParser.reload();
            if (window.imageProcessor) {
                window.imageProcessor._lensProfileKey = null; // force une nouvelle résolution
                window.imageProcessor._refreshLensProfile();
            }
            alert("Profil importé avec succès.");
        };
    }

    if (typeof window.renderPictureControlPanel === "function") {
        window.renderPictureControlPanel("pictureControlStatus", null, {
            compact: false,
            onChange: (state) => {
                if (window.imageProcessor) {
                    window.imageProcessor.setPictureControl(state);
                    // 💾 Sauvegarde automatique des curseurs
                    saveCurrentPhotoSettingsToCatalog();
                }
            }
        });
    }

    renderStudioFolderTree();
    initExportModal();
    initSettingsModal();
    initOpenWithButton();

    if (typeof window.renderMasksPanel === "function") {
        window.renderMasksPanel();
    }

    if (typeof window.renderRetouchPanel === "function") {
        window.renderRetouchPanel();
    }

    if (typeof window.renderFilmPanel === "function") {
        window.renderFilmPanel();
    }

    if (typeof window.renderMonochromePanel === "function") {
        window.renderMonochromePanel();
    }

    ensureStudioNavigationArrows();
    
    // 🔹 Initialisation du gestionnaire ICC pour le module d'impression
    initIccManager();
}

if (window.electronAPI?.onMenuOpenNEF) {
    window.electronAPI.onMenuOpenNEF(async () => {
        try {
            const fileData = await window.electronAPI.openNEF();
            if (!fileData) return;

            const filePath = typeof fileData === "string" ? fileData : (fileData.filePath || fileData.path);

            if (filePath) {
                await window.loadImageInStudio(filePath);
            } else if (fileData.preview && window.imageProcessor) {
                if (typeof window.imageProcessor.clear === "function") {
                    window.imageProcessor.clear();
                }
                await window.imageProcessor.load(fileData.preview, fileData.orientation || 1);
            }
        } catch (err) {
            console.error("❌ Erreur lors de l'affichage de l'image sélectionnée :", err);
        }
    });
}

if (window.electronAPI?.onMenuSwitchView) {
    window.electronAPI.onMenuSwitchView((targetViewId) => {
        if (typeof window.switchToView === "function") {
            window.switchToView(targetViewId);
        }
    });
}

if (window.electronAPI?.onMenuTriggerExport) {
    window.electronAPI.onMenuTriggerExport(async () => {
        const modal = document.getElementById("exportModal");
        if (typeof window.refreshExportColorSpaceDefault === "function") {
            await window.refreshExportColorSpaceDefault();
        }
        if (modal) modal.style.display = "flex";
    });
}

if (window.electronAPI?.onCatalogRestored) {
    window.electronAPI.onCatalogRestored(() => {
        console.log("♻️ Catalogue restauré depuis une sauvegarde, rechargement de l'arborescence...");
        if (typeof window.loadSavedStudioFolders === "function") {
            window.loadSavedStudioFolders();
        }
        alert("Le catalogue a été restauré avec succès.");
    });
}

if (window.electronAPI?.onMenuExportBackup) {
    window.electronAPI.onMenuExportBackup(() => exportCatalogBackup());
}

if (window.electronAPI?.onMenuImportBackup) {
    window.electronAPI.onMenuImportBackup(() => importCatalogBackup());
}

if (window.electronAPI?.onMenuOpenExternalProgramsConfig) {
    window.electronAPI.onMenuOpenExternalProgramsConfig(() => {
        if (typeof window.openExternalProgramsModal === "function") window.openExternalProgramsModal();
    });
}

if (window.electronAPI?.onMenuOpenSettings) {
    window.electronAPI.onMenuOpenSettings((tab) => {
        if (typeof window.openSettingsModal === "function") window.openSettingsModal(tab || "external-programs");
    });
}

const initApp = async () => {
    initButtons();
    await loadSavedStudioFolders();
    if (typeof window.updateFooterCatalogStats === "function") window.updateFooterCatalogStats();
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}

const gridZoomSlider = document.getElementById("gridZoomSlider");
if (gridZoomSlider) {
    gridZoomSlider.oninput = (e) => {
        const size = e.target.value + "px";
        document.documentElement.style.setProperty("--grid-item-size", size);
    };
}

function initIccManager() {
    const btnImportIcc = document.getElementById("btnImportIcc");
    const selectElem = document.getElementById("printIccProfile");

    // Charger les profils sauvegardés dans le localStorage au démarrage
    try {
        const savedIccList = JSON.parse(localStorage.getItem("nikon_icc_library") || "[]");
        if (selectElem && savedIccList.length > 0) {
            savedIccList.forEach(icc => {
                let existingOption = Array.from(selectElem.options).find(opt => opt.value === icc.filePath);
                if (!existingOption) {
                    const option = document.createElement("option");
                    option.value = icc.filePath;
                    option.textContent = icc.fileName;
                    selectElem.appendChild(option);
                }
            });
        }
    } catch (e) {
        console.error("❌ Erreur lecture bibliothèque ICC :", e);
    }

    if (btnImportIcc) {
        btnImportIcc.onclick = async () => {
            try {
                if (window.electronAPI && typeof window.electronAPI.loadICC === "function") {
                    const iccResult = await window.electronAPI.loadICC();
                    if (iccResult && selectElem) {
                        let existingOption = Array.from(selectElem.options).find(opt => opt.value === iccResult.filePath);
                        if (!existingOption) {
                            const option = document.createElement("option");
                            option.value = iccResult.filePath;
                            option.textContent = iccResult.fileName;
                            selectElem.appendChild(option);
                        }
                        selectElem.value = iccResult.filePath;

                        // Sauvegarde dans le localStorage
                        let savedIccList = JSON.parse(localStorage.getItem("nikon_icc_library") || "[]");
                        if (!savedIccList.some(item => item.filePath === iccResult.filePath)) {
                            savedIccList.push(iccResult);
                            localStorage.setItem("nikon_icc_library", JSON.stringify(savedIccList));
                        }

                        // Déclencher le rendu de l'impression
                        if (window.printManager) window.printManager.render();
                    }
                }
            } catch (err) {
                console.error("❌ Erreur lors de l'import du profil ICC :", err);
            }
        };
    }
}

// ============================================================
// EXPOSER LES FONCTIONS AU GLOBAL
// ============================================================

window.saveCurrentPictureControlSettings = saveCurrentPictureControlSettings;
window.loadPictureControlSettings = loadPictureControlSettings;
window.applySettingsToImageProcessor = applySettingsToImageProcessor;
window.applySettingsToSliders = applySettingsToSliders;
window.collectAllFilesFromFolder = collectAllFilesFromFolder;
window.buildTreeHTML = buildTreeHTML;
window.renderStudioFolderTree = renderStudioFolderTree;
window.openStudioFolder = openStudioFolder;
window.loadSavedStudioFolders = loadSavedStudioFolders;
window.renderNp3Library = renderNp3Library;
window.initIccManager = initIccManager;
window.saveCurrentPhotoSettingsToCatalog = saveCurrentPhotoSettingsToCatalog;

console.log("✅ app.js chargé avec persistance des réglages Picture Control");