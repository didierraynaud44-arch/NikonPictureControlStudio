/*=========================================================
    Nikon Picture Control Studio - Controller (app.js)
=========================================================*/

let currentNefFileName = "image-editee";
let profileImageProcessor = null;
let activeProfilePC = null; // Picture Control actuellement affiché dans le Gestionnaire

// Stockage local de la bibliothèque NP3
let np3Library = [];
try {
    np3Library = JSON.parse(localStorage.getItem("nikon_np3_library") || "[]");
} catch (e) {
    console.error("❌ Erreur de lecture de la bibliothèque NP3 :", e);
    np3Library = [];
}

/**
 * Rend le panneau compact du Gestionnaire de Profils
 */
function renderProfilePanel(pc, isNewInstance = false) {
    activeProfilePC = pc;
    if (typeof window.renderPictureControlPanel !== "function") return;

    window.renderPictureControlPanel("profileControlStatus", pc, {
        compact: true,
        extendedNP3: true,
        isNewInstance: isNewInstance,
        onChange: (state) => {
            activeProfilePC = state;
            if (profileImageProcessor) profileImageProcessor.setPictureControl(state);
        }
    });
}

/**
 * Rendu dynamique de la liste des NP3 sauvegardés.
 */
function renderNp3Library() {
    const containerIds = ["np3ListContainerStudio", "np3ListContainerProfiles"];

    containerIds.forEach((containerId) => {
        const container = document.getElementById(containerId);
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
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:170px;">📄 ${item.name}</span>
                <button class="btn-remove-np3" data-index="${index}" title="Supprimer">✕</button>
            `;

            div.onclick = (e) => {
                if (e.target.classList.contains("btn-remove-np3")) return;

                document.querySelectorAll(".np3-item").forEach(el => el.classList.remove("active"));
                div.classList.add("active");

                let pc = item.data?.pictureControl || item.data || {};

                pc.sharpening = pc.sharpening ?? pc.sharpning ?? pc.sharpness ?? 0;
                pc.midRangeSharpening = pc.midRangeSharpening ?? pc.midRangeSharpning ?? 0;

                const viewProfiles = document.getElementById("view-profiles");
                const isProfilesViewActive = viewProfiles && viewProfiles.classList.contains("view-active");

                if (isProfilesViewActive) {
                    if (profileImageProcessor) profileImageProcessor.setPictureControl(pc);
                    renderProfilePanel(pc, true);
                } else {
                    if (window.imageProcessor) window.imageProcessor.setPictureControl(pc);
                    if (typeof window.updatePictureControl === "function") {
                        window.updatePictureControl({ pictureControl: pc }, true);
                    }
                }
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
    });
}

function pathFileName(filePath) {
    return filePath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, "");
}

/**
 * Fonction universelle pour charger une photo depuis le Catalogue ou les menus vers le Studio
 */
async function loadImageInStudio(filePath) {
    if (!filePath) return;

    try {
        currentNefFileName = pathFileName(filePath);

        // 1. Décodage et lecture du fichier via Electron backend
        let fileInfo = null;
        if (window.electronAPI && typeof window.electronAPI.readFileDirect === "function") {
            fileInfo = await window.electronAPI.readFileDirect(filePath);
        }

        if (!fileInfo) {
            console.error("❌ Impossible de lire les données du fichier :", filePath);
            return;
        }

        // 2. Formatage de la source (DataURL pour RAW/NEF ou file:// pour images classiques)
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

        // 3. Mise à jour des informations EXIF
        if (typeof window.updateExif === "function") {
            window.updateExif(fileInfo);
        }

        // 4. Extraction et normalisation du Picture Control
        const pcData = fileInfo.pictureControl || fileInfo.pc || {};
        pcData.sharpening = pcData.sharpening ?? pcData.sharpness ?? 3.25;
        pcData.midRangeSharpening = pcData.midRangeSharpening ?? 1.0;

        // 5. Chargement de la nouvelle image dans le processeur Canvas (avec purge de l'ancienne image)
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
                    aperture: fileInfo.rawAperture || fileInfo.aperture
                }
            );

            // Application immédiate du Picture Control de la NOUVELLE image
            window.imageProcessor.setPictureControl(pcData);
        }

        // 6. Mise à jour de l'IHM avec le nouveau Picture Control
        if (typeof window.updatePictureControl === "function") {
            window.updatePictureControl({
                pictureControl: pcData,
                lens: fileInfo.lens || "Objectif non renseigné",
                isNewFile: true
            }, true);
        }

        // 7. Bascule vers la vue Studio
        if (typeof window.switchToView === "function") {
            window.switchToView("view-studio");
        }

    } catch (err) {
        console.error("❌ Erreur lors du chargement de la photo dans le Studio :", err);
    }
}
window.loadImageInStudio = loadImageInStudio;

/**
 * Initialisation des boutons et des gestionnaires d'événements
 */
function initButtons() {
    const btnNef          = document.getElementById("openNef");
    const btnExportJpg    = document.getElementById("exportJpg");
    const btnOpenProfiles = document.getElementById("btnOpenProfilesPage");
    const btnReturnStudio = document.getElementById("btnReturnToStudio");
    const btnNP3          = document.getElementById("openNP3");
    const btnSaveNP3      = document.getElementById("saveNP3");
    const btnExportNCP    = document.getElementById("exportNCP");
    const btnOpenCatalog  = document.getElementById("btnOpenCatalog");

    const headerStudio    = document.getElementById("header-studio-actions");
    const headerProfiles  = document.getElementById("header-profile-actions");

    const ALL_VIEW_IDS = ["view-studio", "view-profiles", "view-catalog"];

    // Bascule entre les vues principales
    function switchToView(targetViewId) {
        ALL_VIEW_IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.removeProperty("display");
            if (id === targetViewId) {
                el.classList.remove("view-hidden");
                el.classList.add("view-active");
            } else {
                el.classList.remove("view-active");
                el.classList.add("view-hidden");
            }
        });

        if (headerStudio) headerStudio.style.display = (targetViewId === "view-studio") ? "flex" : "none";
        if (headerProfiles) headerProfiles.style.display = (targetViewId === "view-profiles") ? "flex" : "none";
    }
    window.switchToView = switchToView;

    // Affichage par défaut au démarrage
    switchToView("view-studio");

    // Instanciation du processeur WebGL principal
    if (!window.imageProcessor && typeof ImageProcessor !== "undefined") {
        const studioCanvas = document.getElementById("previewCanvas");
        if (studioCanvas) {
            window.imageProcessor = new ImageProcessor("previewCanvas");
        }
    }

    if (window.imageProcessor && typeof window.initMasksController === "function") {
        window.initMasksController(window.imageProcessor);
    }

    /* 1. Navigation entre les Vues */
    if (btnOpenProfiles) {
        btnOpenProfiles.onclick = async () => {
            switchToView("view-profiles");

            if (!profileImageProcessor && typeof ImageProcessor !== "undefined") {
                const profileCanvas = document.getElementById("profilePreviewCanvas");
                if (profileCanvas) {
                    profileImageProcessor = new ImageProcessor("profilePreviewCanvas");
                }
            }

            if (profileImageProcessor && window.imageProcessor?.loadedImage) {
                await profileImageProcessor.load(
                    window.imageProcessor.loadedImage.src,
                    window.imageProcessor.currentOrientation
                );
            }

            const pcToShow = activeProfilePC || window.imageProcessor?.pictureControl || null;
            if (pcToShow) {
                if (profileImageProcessor) profileImageProcessor.setPictureControl(pcToShow);
                renderProfilePanel(pcToShow, true);
            }

            renderNp3Library();
        };
    }

    if (btnReturnStudio) {
        btnReturnStudio.onclick = () => {
            switchToView("view-studio");

            if (activeProfilePC && window.imageProcessor) {
                window.imageProcessor.setPictureControl(activeProfilePC);
                if (typeof window.updatePictureControl === "function") {
                    window.updatePictureControl({ pictureControl: activeProfilePC }, true);
                }
            }
        };
    }

    if (btnOpenCatalog) {
        btnOpenCatalog.onclick = () => {
            switchToView("view-catalog");
            if (typeof refreshFolders === "function") refreshFolders();
            if (typeof refreshGrid === "function") refreshGrid();
        };
    }

    /* 2. Bouton "Ouvrir une image / RAW" (Boîte de dialogue native) */
    if (btnNef) {
        btnNef.onclick = async () => {
            try {
                const fileInfo = await window.electronAPI.openNEF();
                if (!fileInfo) return;

                const newFilePath = fileInfo.filePath || fileInfo.path;
                if (newFilePath) {
                    await loadImageInStudio(newFilePath);
                }
            } catch (err) {
                console.error("❌ Erreur d'ouverture NEF :", err);
            }
        };
    }

    /* 3. Imports & Exports */
    if (btnNP3) {
        btnNP3.onclick = async () => {
            try {
                const response = await window.electronAPI.loadNP3();
                if (response) {
                    const pc = response.pictureControl || response.pc || response;
                    
                    pc.sharpening = pc.sharpening ?? pc.sharpning ?? pc.sharpness ?? 0;
                    pc.midRangeSharpening = pc.midRangeSharpening ?? pc.midRangeSharpning ?? 0;

                    const name = response.fileName || response.name || pc.name || `Profil ${np3Library.length + 1}`;

                    np3Library.push({ name: name, data: pc });
                    localStorage.setItem("nikon_np3_library", JSON.stringify(np3Library));
                    renderNp3Library();

                    if (profileImageProcessor) profileImageProcessor.setPictureControl(pc);
                    renderProfilePanel(pc, true);
                }
            } catch (err) {
                console.error("❌ Erreur d'importation NP3 :", err);
            }
        };
    }

    if (btnSaveNP3) {
        btnSaveNP3.onclick = async () => {
            try {
                const activePC = activeProfilePC || profileImageProcessor?.pictureControl;
                if (activePC && window.electronAPI) {
                    await window.electronAPI.saveNP3File(activePC);
                }
            } catch (err) {
                console.error("❌ Erreur d'enregistrement NP3 :", err);
            }
        };
    }

    if (btnExportNCP) {
        btnExportNCP.onclick = async () => {
            try {
                const activePC = activeProfilePC || profileImageProcessor?.pictureControl;

                if (activePC && window.electronAPI) {
                    await window.electronAPI.exportNCP(activePC);
                } else {
                    console.warn("⚠️ Aucun Picture Control actif à exporter.");
                }
            } catch (err) {
                console.error("❌ Erreur d'exportation NCP :", err);
            }
        };
    }

    if (btnExportJpg) {
        btnExportJpg.onclick = async () => {
            try {
                const activeProcessor = window.imageProcessor;
                if (!activeProcessor) return;

                const base64Data = await activeProcessor.exportImage("image/jpeg", 0.95);
                if (base64Data && window.electronAPI) {
                    await window.electronAPI.saveImageFile({
                        defaultName: currentNefFileName,
                        base64Data: base64Data
                    });
                }
            } catch (err) {
                console.error("❌ Erreur d'exportation JPG :", err);
            }
        };
    }

    renderNp3Library();
    if (typeof window.renderMasksPanel === "function") window.renderMasksPanel();
}

// Écouteur pour le menu supérieur Electron ("Fichier -> Ouvrir")
if (window.electronAPI?.onMenuOpenNEF) {
    window.electronAPI.onMenuOpenNEF(() => {
        const btnNef = document.getElementById("openNef");
        if (btnNef) btnNef.click();
    });
}

// Démarrage de l'application au chargement du DOM
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initButtons);
} else {
    initButtons();
}
// A ajouter au début de initButtons()
/* --- Module de Rotation & Miroir --- */
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
    }
}

// Calcule l'angle fin relatif (-45 à +45)
function getFineAngle() {
    const base90 = Math.round(currentTransform.rotation / 90) * 90;
    return parseFloat((currentTransform.rotation - base90).toFixed(1));
}

// Met à jour la valeur affichée dans le slider et l'input sans casser la base 90°
function syncDegreeInputs() {
    const fineAngle = getFineAngle();
    if (rangeDegree) rangeDegree.value = fineAngle;
    if (inputDegree) inputDegree.value = fineAngle;
}

if (btnRotateLeft) {
    btnRotateLeft.onclick = () => {
        currentTransform.rotation = currentTransform.rotation - 90;
        applyStudioTransform();
    };
}

if (btnRotateRight) {
    btnRotateRight.onclick = () => {
        currentTransform.rotation = currentTransform.rotation + 90;
        applyStudioTransform();
    };
}

if (btnFlipH) {
    btnFlipH.onclick = () => {
        currentTransform.flipH = !currentTransform.flipH;
        btnFlipH.classList.toggle("active", currentTransform.flipH);
        applyStudioTransform();
    };
}

if (btnFlipV) {
    btnFlipV.onclick = () => {
        currentTransform.flipV = !currentTransform.flipV;
        btnFlipV.classList.toggle("active", currentTransform.flipV);
        applyStudioTransform();
    };
}

// Modification via le curseur
if (rangeDegree) {
    rangeDegree.oninput = (e) => {
        const fineAngle = parseFloat(e.target.value) || 0;
        const base90 = Math.round(currentTransform.rotation / 90) * 90;
        currentTransform.rotation = base90 + fineAngle;
        if (inputDegree) inputDegree.value = fineAngle;
        applyStudioTransform();
    };
}

// Modification via la case numérique
if (inputDegree) {
    const handleInput = () => {
        let val = parseFloat(inputDegree.value);
        if (isNaN(val)) val = 0;
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
        syncDegreeInputs();
        if (btnFlipH) btnFlipH.classList.remove("active");
        if (btnFlipV) btnFlipV.classList.remove("active");
        applyStudioTransform();
    };
}

if (btnRotateRight) {
    btnRotateRight.onclick = () => {
        currentTransform.rotation = (currentTransform.rotation + 90) % 360;
        applyStudioTransform();
    };
}

if (btnFlipH) {
    btnFlipH.onclick = () => {
        currentTransform.flipH = !currentTransform.flipH;
        btnFlipH.classList.toggle("active", currentTransform.flipH);
        applyStudioTransform();
    };
}

if (btnFlipV) {
    btnFlipV.onclick = () => {
        currentTransform.flipV = !currentTransform.flipV;
        btnFlipV.classList.toggle("active", currentTransform.flipV);
        applyStudioTransform();
    };
}

if (rangeDegree) {
    rangeDegree.oninput = (e) => {
        const fineAngle = parseFloat(e.target.value);
        const base90 = Math.round(currentTransform.rotation / 90) * 90;
        currentTransform.rotation = base90 + fineAngle;
        applyStudioTransform();
    };
}

if (btnResetRot) {
    btnResetRot.onclick = () => {
        currentTransform = { rotation: 0, flipH: false, flipV: false };
        if (rangeDegree) rangeDegree.value = 0;
        if (btnFlipH) btnFlipH.classList.remove("active");
        if (btnFlipV) btnFlipV.classList.remove("active");
        applyStudioTransform();
    };
}