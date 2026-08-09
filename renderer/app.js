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

// Cache mémoire pour accélérer le passage d'une photo à l'autre
const studioImageCache = new Map();

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
function buildTreeHTML(node) {
    if (!node) return document.createTextNode("");

    const ul = document.createElement("ul");
    ul.style.listStyle = "none";
    ul.style.paddingLeft = "10px";
    ul.style.margin = "0";

    if (node.children && node.children.length > 0) {
        // 🔹 Tri strict et naturel (type Windows) des sous-dossiers dans l'interface
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
            title.innerHTML = `📁 <span style="user-select:none;">${subFolder.name}</span>`;

            const subTreeContainer = document.createElement("div");
            subTreeContainer.style.display = "none";

            title.onclick = (e) => {
                e.stopPropagation();
                const isHidden = subTreeContainer.style.display === "none";
                subTreeContainer.style.display = isHidden ? "block" : "none";
                title.firstChild.textContent = isHidden ? "📂 " : "📁 ";

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
        // 🔹 Tri strict et naturel des fichiers images
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
    prevBtn.innerHTML = "❮";
    prevBtn.onclick = () => navigateStudioPhoto(-1);

    const nextBtn = document.createElement("button");
    nextBtn.className = "studio-nav-btn studio-next-btn";
    nextBtn.title = "Photo suivante (Flèche droite)";
    nextBtn.innerHTML = "❯";
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
        return;
    }

    // 🔹 Tri des dossiers racines importés
    const sortedFoldersList = [...studioFoldersList].sort((a, b) => {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

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
        rootTitle.style.cssText = "font-size: 12px; font-weight: bold; color: #5865f2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
        rootTitle.innerHTML = `📁 ${folderStructure.name}`;

        const rootTreeContainer = document.createElement("div");
        rootTreeContainer.style.display = "none";

        rootHeader.onclick = (e) => {
            if (e.target.classList.contains("btn-remove-folder")) return;
            const isHidden = rootTreeContainer.style.display === "none";
            rootTreeContainer.style.display = isHidden ? "block" : "none";
            rootTitle.innerHTML = `${isHidden ? "📂" : "📁"} ${folderStructure.name}`;

            if (window.gridManager) {
                const allFolderFiles = collectAllFilesFromFolder(folderStructure);
                window.gridManager.setImages(allFolderFiles);
            }
        };

        const btnRemove = document.createElement("button");
        btnRemove.className = "btn-remove-folder";
        btnRemove.title = "Retirer du catalogue";
        btnRemove.innerHTML = "🗑️";
        btnRemove.style.cssText = "background: transparent; border: none; cursor: pointer; font-size: 11px; padding: 2px 4px; margin-left: 6px;";
        
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
}

async function removeStudioFolder(folderPath) {
    if (window.electronAPI && typeof window.electronAPI.removeCatalogFolder === "function") {
        studioFoldersList = await window.electronAPI.removeCatalogFolder(folderPath);
        renderStudioFolderTree();
    }
}

async function openStudioFolder() {
    try {
        if (window.electronAPI && typeof window.electronAPI.selectFolderRecursive === "function") {
            const folderData = await window.electronAPI.selectFolderRecursive();
            if (folderData && folderData.path) {
                if (typeof window.electronAPI.addCatalogFolder === "function") {
                    studioFoldersList = await window.electronAPI.addCatalogFolder(folderData);
                    renderStudioFolderTree();
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

    window.currentStudioFilePath = filePath;

    try {
        currentNefFileName = pathFileName(filePath);

        let fileInfo = null;

        if (studioImageCache.has(filePath)) {
            fileInfo = studioImageCache.get(filePath);
        } else {
            if (window.electronAPI && typeof window.electronAPI.readFileDirect === "function") {
                fileInfo = await window.electronAPI.readFileDirect(filePath);
            }
            if (fileInfo) {
                studioImageCache.set(filePath, fileInfo);
            }
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

        if (typeof window.switchToView === "function") {
            window.switchToView("view-studio");
        }

        // 🔹 AJOUT : Partager l'image avec le PrintManager
        if (window.printManager && fileInfo) {
            const pcForPrint = fileInfo.pictureControl || fileInfo.pc || {};
            try {
                window.printManager.setImage(filePath, pcForPrint);
                console.log("✅ Image partagée avec PrintManager:", filePath);
            } catch (pmErr) {
                console.warn("⚠️ Erreur partage avec PrintManager:", pmErr);
            }
        }

        prefetchAdjacentImages(filePath);

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

/* =========================================================
    MODULE EXPORTATION
========================================================= */

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
            const config = {
                folder: folderInput ? folderInput.value : "",
                format: document.getElementById("expFormat")?.value || "image/jpeg",
                quality: qualitySlider ? parseFloat(qualitySlider.value) / 100 : 0.9,
                width: parseInt(document.getElementById("expWidth")?.value) || null,
                height: parseInt(document.getElementById("expHeight")?.value) || null,
                dpi: parseInt(document.getElementById("expDpi")?.value) || 300,
                stripExif: document.getElementById("expStripExif")?.checked || false
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
                    // ===== NOUVELLE VERSION : Export en pleine résolution avec modifications =====
                    if (!window.imageProcessor) {
                        alert("❌ Aucune image chargée à exporter");
                        return;
                    }

                    // Utiliser la nouvelle méthode exportFullResolution
                    const dataUrl = window.imageProcessor.exportFullResolution(
                        config.quality,
                        config.format
                    );

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
                        alert(res?.success ? "✅ Export réussi !" : `❌ Erreur d'export : ${res?.error || "Échec inconnu"}`);
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
    }
}
window.switchToView = switchToView;

function initButtons() {
    const btnSaveNP3           = document.getElementById("saveNP3");
    const btnExportNCP         = document.getElementById("exportNCP");
    const btnStudioOpenFolder  = document.getElementById("btnStudioOpenFolder");
    const btnNP3               = document.getElementById("openNP3");
    const btnViewPrint         = document.getElementById("btnViewPrint");
    const btnViewPrintFromProfile = document.getElementById("btnViewPrintFromProfile");
    const btnBackToStudio      = document.getElementById("btnBackToStudio");

    switchToView("view-studio");

    if (btnViewPrint) {
        btnViewPrint.onclick = () => switchToView("view-print");
    }
    if (btnViewPrintFromProfile) {
        btnViewPrintFromProfile.onclick = () => switchToView("view-print");
    }
    if (btnBackToStudio) {
        btnBackToStudio.onclick = () => switchToView("view-studio");
    }

    if (!window.imageProcessor && typeof ImageProcessor !== "undefined") {
        window.imageProcessor = new ImageProcessor("previewCanvas");
    }

    if (window.imageProcessor && typeof window.initMasksController === "function") {
        window.initMasksController(window.imageProcessor);
    }

    if (btnStudioOpenFolder) {
        btnStudioOpenFolder.onclick = openStudioFolder;
    }

    const importProfileFile = async () => {
        try {
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
    initExportModal();

    if (typeof window.renderMasksPanel === "function") window.renderMasksPanel();

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
    window.electronAPI.onMenuTriggerExport(() => {
        const modal = document.getElementById("exportModal");
        if (modal) modal.style.display = "flex";
    });
}

const initApp = async () => {
    initButtons();
    await loadSavedStudioFolders();
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