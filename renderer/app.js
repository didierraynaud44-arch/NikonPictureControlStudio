/*=========================================================
    Nikon Picture Control Studio - Controller (app.js)
=========================================================*/

let currentNefFileName = "image-editee";
let profileImageProcessor = null;
let activeProfilePC = null; // Picture Control actif dans le Gestionnaire
let studioFoldersList = []; // Liste de toutes les structures de dossiers importées

// Stockage local de la bibliothèque NP3 / Profils
let np3Library = [];
try {
    np3Library = JSON.parse(localStorage.getItem("nikon_np3_library") || "[]");
} catch (e) {
    console.error("❌ Erreur de lecture de la bibliothèque NP3 :", e);
    np3Library = [];
}

/* =========================================================
    MODULE ARBORESCENCE DOSSIERS / FICHIERS (STUDIO)
========================================================= */

/**
 * Construit récursivement l'arborescence HTML (Fermée par défaut)
 */
function buildTreeHTML(node) {
    if (!node) return document.createTextNode("");

    const ul = document.createElement("ul");
    ul.style.listStyle = "none";
    ul.style.paddingLeft = "10px";
    ul.style.margin = "0";

    // 1. Sous-dossiers
    if (node.children && node.children.length > 0) {
        node.children.forEach(subFolder => {
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
            title.innerHTML = `📁 <span style="user-select:none;">${subFolder.name}</span>`;

            const subTreeContainer = document.createElement("div");
            subTreeContainer.style.display = "none"; // 🔒 FERMÉ PAR DÉFAUT

            title.onclick = (e) => {
                e.stopPropagation();
                const isHidden = subTreeContainer.style.display === "none";
                subTreeContainer.style.display = isHidden ? "block" : "none";
                title.firstChild.textContent = isHidden ? "📂 " : "📁 ";
            };

            li.appendChild(title);
            li.appendChild(subTreeContainer);
            subTreeContainer.appendChild(buildTreeHTML(subFolder));
            ul.appendChild(li);
        });
    }

    // 2. Fichiers image du dossier
    if (node.files && node.files.length > 0) {
        node.files.forEach(file => {
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
            li.textContent = `🖼️ ${file.name}`;
            li.title = file.path;

            li.onclick = async (e) => {
                e.stopPropagation();
                document.querySelectorAll(".tree-file-item").forEach(el => {
                    el.style.background = "transparent";
                    el.style.color = "#b0b5ba";
                });
                li.style.background = "#1a73e8";
                li.style.color = "#ffffff";

                if (typeof window.loadImageInStudio === "function") {
                    await window.loadImageInStudio(file.path);
                }
            };

            // Effet survol
            li.onmouseenter = () => { if (li.style.background !== "rgb(26, 115, 232)") li.style.background = "#2a2d32"; };
            li.onmouseleave = () => { if (li.style.background !== "rgb(26, 115, 232)") li.style.background = "transparent"; };

            ul.appendChild(li);
        });
    }

    return ul;
}

/**
 * Rendu de la liste de tous les dossiers importés
 */
function renderStudioFolderTree() {
    const container = document.getElementById("studioFolderTree");
    if (!container) return;

    container.innerHTML = "";

    if (!studioFoldersList || studioFoldersList.length === 0) {
        container.innerHTML = `<p style="color:#777; font-size:11px; font-style:italic; padding:8px; margin:0;">Aucun dossier importé</p>`;
        return;
    }

    // Affichage de chaque dossier racine importé
    studioFoldersList.forEach((folderStructure, index) => {
        const rootItem = document.createElement("div");
        rootItem.style.marginBottom = "8px";
        rootItem.style.borderBottom = "1px solid #2b2d31";
        rootItem.style.paddingBottom = "4px";

        // En-tête du dossier racine avec bouton de suppression
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
        rootTitle.style.cssText = "font-size: 12px; font-weight: bold; color: #5865f2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
        rootTitle.innerHTML = `📁 ${folderStructure.name}`;

        const rootTreeContainer = document.createElement("div");
        rootTreeContainer.style.display = "none"; // 🔒 FERMÉ PAR DÉFAUT

        rootHeader.onclick = (e) => {
            if (e.target.classList.contains("btn-remove-folder")) return;
            const isHidden = rootTreeContainer.style.display === "none";
            rootTreeContainer.style.display = isHidden ? "block" : "none";
            rootTitle.innerHTML = `${isHidden ? "📂" : "📁"} ${folderStructure.name}`;
        };

        const btnRemove = document.createElement("button");
        btnRemove.className = "btn-remove-folder";
        btnRemove.title = "Retirer ce dossier";
        btnRemove.innerHTML = "🗑️";
        btnRemove.style.cssText = "background: transparent; border: none; cursor: pointer; font-size: 11px; padding: 2px 4px; margin-left: 6px;";
        
        btnRemove.onclick = (e) => {
            e.stopPropagation();
            removeStudioFolder(index);
        };

        rootHeader.appendChild(rootTitle);
        rootHeader.appendChild(btnRemove);
        rootItem.appendChild(rootHeader);

        rootTreeContainer.appendChild(buildTreeHTML(folderStructure));
        rootItem.appendChild(rootTreeContainer);

        container.appendChild(rootItem);
    });
}

/**
 * Supprime un dossier de la liste et met à jour le stockage
 */
function removeStudioFolder(index) {
    studioFoldersList.splice(index, 1);
    saveSavedStudioFoldersList();
    renderStudioFolderTree();
}

/**
 * Sauvegarde la liste des chemins de dossiers dans le localStorage
 */
function saveSavedStudioFoldersList() {
    const paths = studioFoldersList.map(f => f.path);
    localStorage.setItem("nikon_studio_folders_paths", JSON.stringify(paths));
}

/**
 * Ouvre la boîte de dialogue pour importer un nouveau répertoire
 */
async function openStudioFolder() {
    try {
        if (window.electronAPI && typeof window.electronAPI.selectFolderRecursive === "function") {
            const folderData = await window.electronAPI.selectFolderRecursive();
            if (folderData && folderData.path) {
                // Évite d'ajouter des doublons
                const exists = studioFoldersList.some(f => f.path === folderData.path);
                if (!exists) {
                    studioFoldersList.push(folderData);
                    saveSavedStudioFoldersList();
                    renderStudioFolderTree();
                }
            }
        } else {
            console.error("❌ Méthode selectFolderRecursive indisponible dans electronAPI");
        }
    } catch (err) {
        console.error("❌ Erreur lors de l'ouverture du dossier :", err);
    }
}

/**
 * Recharge automatiquement tous les dossiers sauvegardés au lancement
 */
async function loadSavedStudioFolders() {
    let savedPaths = [];
    try {
        savedPaths = JSON.parse(localStorage.getItem("nikon_studio_folders_paths") || "[]");
    } catch (e) {
        savedPaths = [];
    }

    // Rétro-compatibilité si un seul dossier était sauvegardé sous l'ancienne clé
    const oldPath = localStorage.getItem("nikon_studio_last_folder");
    if (oldPath && !savedPaths.includes(oldPath)) {
        savedPaths.push(oldPath);
        localStorage.removeItem("nikon_studio_last_folder");
    }

    if (!savedPaths.length) return;

    studioFoldersList = [];

    for (const folderPath of savedPaths) {
        try {
            if (window.electronAPI && typeof window.electronAPI.readFolderRecursive === "function") {
                const folderData = await window.electronAPI.readFolderRecursive(folderPath);
                if (folderData) {
                    studioFoldersList.push(folderData);
                }
            }
        } catch (err) {
            console.error("❌ Impossible de recharger le dossier :", folderPath, err);
        }
    }

    saveSavedStudioFoldersList();
    renderStudioFolderTree();
}


/* =========================================================
    MODULE PROFILE MANAGER (NP3 / NCP)
========================================================= */

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
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:170px;">📄 ${item.name}</span>
            <button class="btn-remove-np3" data-index="${index}" title="Supprimer">✕</button>
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
    CHARGEMENT STUDIO & RENDERER
========================================================= */

async function loadImageInStudio(filePath) {
    if (!filePath) return;

    try {
        currentNefFileName = pathFileName(filePath);

        let fileInfo = null;
        if (window.electronAPI && typeof window.electronAPI.readFileDirect === "function") {
            fileInfo = await window.electronAPI.readFileDirect(filePath);
        }

        if (!fileInfo) {
            console.error("❌ Impossible de lire le fichier :", filePath);
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

        if (typeof window.updateExif === "function") {
            window.updateExif(fileInfo);
        }

        const pcData = fileInfo.pictureControl || fileInfo.pc || {};
        pcData.sharpening = pcData.sharpening ?? pcData.sharpness ?? 3.25;
        pcData.midRangeSharpening = pcData.midRangeSharpening ?? 1.0;

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

            window.imageProcessor.setPictureControl(pcData);
        }

        if (typeof window.updatePictureControl === "function") {
            window.updatePictureControl({
                pictureControl: pcData,
                lens: fileInfo.lens || "Objectif non renseigné",
                isNewFile: true
            }, true);
        }

        const btnExportJpg = document.getElementById("exportJpg");
        if (btnExportJpg) {
            btnExportJpg.style.display = "inline-block";
        }

        if (typeof window.switchToView === "function") {
            window.switchToView("view-studio");
        }

    } catch (err) {
        console.error("❌ Erreur lors du chargement dans le Studio :", err);
    }
}
window.loadImageInStudio = loadImageInStudio;


/* =========================================================
    INITIALISATION ET EVENEMENTS IHM
========================================================= */

function initButtons() {
    const btnExportJpg         = document.getElementById("exportJpg");
    const btnOpenProfiles      = document.getElementById("btnOpenProfilesPage");
    const btnReturnStudio      = document.getElementById("btnReturnToStudio");
    const btnSaveNP3           = document.getElementById("saveNP3");
    const btnExportNCP         = document.getElementById("exportNCP");
    const btnStudioOpenFolder  = document.getElementById("btnStudioOpenFolder");

    const btnImportMenu        = document.getElementById("btnImportProfileMenu");
    const dropdownContent      = document.getElementById("importDropdownContent");
    const btnNP3               = document.getElementById("openNP3");
    const btnNCP               = document.getElementById("openNCP");

    const headerStudio         = document.getElementById("header-studio-actions");
    const headerProfiles       = document.getElementById("header-profile-actions");

    const ALL_VIEW_IDS = ["view-studio", "view-profiles"];

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

    switchToView("view-studio");

    if (!window.imageProcessor && typeof ImageProcessor !== "undefined") {
        window.imageProcessor = new ImageProcessor("previewCanvas");
    }

    if (window.imageProcessor && typeof window.initMasksController === "function") {
        window.initMasksController(window.imageProcessor);
    }

    if (btnStudioOpenFolder) {
        btnStudioOpenFolder.onclick = openStudioFolder;
    }

    if (btnOpenProfiles) {
        btnOpenProfiles.onclick = async () => {
            switchToView("view-profiles");

            if (!profileImageProcessor && typeof ImageProcessor !== "undefined") {
                profileImageProcessor = new ImageProcessor("profilePreviewCanvas");
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

    if (btnImportMenu && dropdownContent) {
        btnImportMenu.onclick = (e) => {
            e.stopPropagation();
            const isVisible = dropdownContent.style.display === "block";
            dropdownContent.style.display = isVisible ? "none" : "block";
        };

        window.addEventListener("click", () => {
            if (dropdownContent) dropdownContent.style.display = "none";
        });
    }

    const importProfileFile = async () => {
        try {
            if (dropdownContent) dropdownContent.style.display = "none";

            const response = await window.electronAPI.loadNP3();
            if (response) {
                const pc = response.pictureControl || response.pc || response;
                const name = response.fileName || response.name || pc.name || `Profil ${np3Library.length + 1}`;

                np3Library.push({ name: name, data: pc });
                localStorage.setItem("nikon_np3_library", JSON.stringify(np3Library));
                renderNp3Library();

                if (profileImageProcessor) profileImageProcessor.setPictureControl(pc);
                renderProfilePanel(pc, true);
            }
        } catch (err) {
            console.error("❌ Erreur lors de l'importation du profil :", err);
        }
    };

    if (btnNP3) btnNP3.onclick = importProfileFile;
    if (btnNCP) btnNCP.onclick = importProfileFile;

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

    if (btnExportJpg) {
        btnExportJpg.onclick = async () => {
            if (!window.imageProcessor) return;
            const base64Data = await window.imageProcessor.exportImage("image/jpeg", 0.95);
            if (base64Data && window.electronAPI) {
                await window.electronAPI.saveImageFile({
                    defaultName: currentNefFileName,
                    base64Data: base64Data
                });
            }
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

    if (typeof window.renderPictureControlPanel === "function") {
        window.renderPictureControlPanel("pictureControlStatus", null, {
            compact: false,
            onChange: (state) => {
                if (window.imageProcessor) window.imageProcessor.setPictureControl(state);
            }
        });
    }

    renderStudioFolderTree();
    if (typeof window.renderMasksPanel === "function") window.renderMasksPanel();
}

if (window.electronAPI?.onMenuOpenNEF) {
    window.electronAPI.onMenuOpenNEF(() => {
        openStudioFolder();
    });
}

// Initialisation globale + Rechargement automatique des dossiers
const initApp = async () => {
    initButtons();
    await loadSavedStudioFolders();
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}