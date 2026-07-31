/*=========================================================
    Nikon Picture Control Studio - Controller (app.js)
=========================================================*/

let currentNefFileName = "image-editee";
let profileImageProcessor = null;

// Stockage local de la bibliothèque NP3
let np3Library = [];
try {
    np3Library = JSON.parse(localStorage.getItem("nikon_np3_library") || "[]");
} catch (e) {
    console.error("❌ Erreur de lecture de la bibliothèque NP3 :", e);
    np3Library = [];
}

/**
 * Rendu dynamique de la liste des NP3 sauvegardés (Colonne gauche)
 */
function renderNp3Library() {
    const container = document.getElementById("np3ListContainer");
    if (!container) {
        console.warn("⚠️ Conteneur #np3ListContainer non trouvé");
        return;
    }

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

        // Appliquer le profil au clic sur l'élément
        div.onclick = (e) => {
            if (e.target.classList.contains("btn-remove-np3")) return;

            document.querySelectorAll(".np3-item").forEach(el => el.classList.remove("active"));
            div.classList.add("active");

            const activeProc = profileImageProcessor || window.imageProcessor;
            if (activeProc) {
                activeProc.setPictureControl(item.data);
            }
            if (typeof window.updatePictureControl === "function") {
                window.updatePictureControl({ pictureControl: item.data });
            }
        };

        // Supprimer un profil de la liste
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

/**
 * Initialisation des boutons et de la logique de navigation
 */
function initButtons() {
    const btnNef          = document.getElementById("openNef");
    const btnExportJpg    = document.getElementById("exportJpg");
    const btnOpenProfiles = document.getElementById("btnOpenProfilesPage");
    const btnReturnStudio = document.getElementById("btnReturnToStudio");
    const btnNP3          = document.getElementById("openNP3");
    const btnSaveNP3      = document.getElementById("saveNP3");
    const btnExportNCP    = document.getElementById("exportNCP");

    const viewStudio      = document.getElementById("view-studio");
    const viewProfiles    = document.getElementById("view-profiles");
    const headerStudio    = document.getElementById("header-studio-actions");
    const headerProfiles  = document.getElementById("header-profile-actions");

    // S'assurer de la visibilité par défaut de la Vue 1 (Studio)
    if (headerStudio) headerStudio.style.display = "flex";
    if (headerProfiles) headerProfiles.style.display = "none";
    if (viewStudio) viewStudio.style.display = "flex";
    if (viewProfiles) viewProfiles.style.display = "none";

    // Instancier le processeur Studio par défaut s'il n'existe pas encore
    if (!window.imageProcessor && typeof ImageProcessor !== "undefined") {
        const studioCanvas = document.getElementById("previewCanvas");
        if (studioCanvas) {
            window.imageProcessor = new ImageProcessor("previewCanvas");
        }
    }

    /*---------------------------------------------------------
        1. Navigation entre Studio et Gestionnaire
    ---------------------------------------------------------*/
    if (btnOpenProfiles) {
        btnOpenProfiles.onclick = async () => {
            if (viewStudio) viewStudio.style.display = "none";
            if (headerStudio) headerStudio.style.display = "none";

            if (viewProfiles) viewProfiles.style.display = "flex";
            if (headerProfiles) headerProfiles.style.display = "flex";

            // 1. Déplacer dynamiquement le panneau de réglages dans la Vue 2 si nécessaire
            const settingsContainerVue1 = document.querySelector("#view-studio #pictureControlStatus");
            const settingsContainerVue2 = document.querySelector("#view-profiles #pictureControlStatus");
            
            if (settingsContainerVue1 && settingsContainerVue2 && settingsContainerVue1.children.length > 0) {
                settingsContainerVue2.appendChild(settingsContainerVue1.firstElementChild);
            }

            // 2. Initialiser le Canvas de la vue Gestionnaire si nécessaire
            if (!profileImageProcessor && typeof ImageProcessor !== "undefined") {
                const profileCanvas = document.getElementById("profilePreviewCanvas");
                if (profileCanvas) {
                    profileImageProcessor = new ImageProcessor("profilePreviewCanvas");
                }
            }

            // 3. Synchroniser l'image du Studio vers le Gestionnaire
            if (profileImageProcessor && window.imageProcessor?.loadedImage) {
                await profileImageProcessor.load(
                    window.imageProcessor.loadedImage.src,
                    window.imageProcessor.currentOrientation
                );

                if (window.imageProcessor.pictureControl) {
                    profileImageProcessor.setPictureControl(window.imageProcessor.pictureControl);
                }
            }

            // 4. Forcer le rendu de la bibliothèque NP3
            renderNp3Library();
        };
    }

    if (btnReturnStudio) {
        btnReturnStudio.onclick = () => {
            if (viewProfiles) viewProfiles.style.display = "none";
            if (headerProfiles) headerProfiles.style.display = "none";

            if (viewStudio) viewStudio.style.display = "flex";
            if (headerStudio) headerStudio.style.display = "flex";

            // Déplacer le panneau de réglages de retour vers la Vue 1
            const settingsContainerVue1 = document.querySelector("#view-studio #pictureControlStatus");
            const settingsContainerVue2 = document.querySelector("#view-profiles #pictureControlStatus");
            
            if (settingsContainerVue1 && settingsContainerVue2 && settingsContainerVue2.children.length > 0) {
                settingsContainerVue1.appendChild(settingsContainerVue2.firstElementChild);
            }

            // Reporter les réglages vers l'instance principale
            if (profileImageProcessor && window.imageProcessor) {
                window.imageProcessor.setPictureControl(profileImageProcessor.pictureControl);
            }
        };
    }

    /*---------------------------------------------------------
        2. Chargement des fichiers RAW / NEF
    ---------------------------------------------------------*/
    if (btnNef) {
        btnNef.onclick = async () => {
            try {
                const fileInfo = await window.electronAPI.openNEF();
                if (!fileInfo) return;

                if (fileInfo.fileName) {
                    currentNefFileName = fileInfo.fileName.replace(/\.[^/.]+$/, "");
                }

                if (typeof window.updateExif === "function") {
                    window.updateExif(fileInfo);
                }

                let rawSrc = fileInfo.previewPath || fileInfo.preview || fileInfo.imageData || fileInfo.image || fileInfo.path;
                let imageSrc = "";

                if (rawSrc) {
                    if (rawSrc.startsWith("data:")) {
                        imageSrc = rawSrc;
                    } else if (/^[A-Za-z0-9+/=]+$/.test(rawSrc.trim().substring(0, 100))) {
                        imageSrc = `data:image/jpeg;base64,${rawSrc.trim()}`;
                    } else {
                        const formattedPath = rawSrc.replace(/\\/g, "/");
                        imageSrc = formattedPath.startsWith("/") ? `file://${formattedPath}` : `file:///${formattedPath}`;
                    }
                }

                const pcData = fileInfo.pictureControl || fileInfo.pc || {
                    sharpening: 3.25,
                    midRangeSharpening: 1.0,
                    clarity: 1.0,
                    contrast: 0,
                    highlights: 0,
                    shadows: 0,
                    saturation: 0,
                    hue: 0
                };

                if (imageSrc && window.imageProcessor) {
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
                    });
                }
            } catch (err) {
                console.error("❌ Erreur d'ouverture NEF :", err);
            }
        };
    }

    /*---------------------------------------------------------
        3. Imports NP3 & Exports
    ---------------------------------------------------------*/
    if (btnNP3) {
        btnNP3.onclick = async () => {
            try {
                const response = await window.electronAPI.loadNP3();
                if (response) {
                    const pc = response.pictureControl || response.pc || response;
                    const name = response.fileName || response.name || `Profil ${np3Library.length + 1}`;

                    np3Library.push({ name: name, data: pc });
                    localStorage.setItem("nikon_np3_library", JSON.stringify(np3Library));
                    renderNp3Library();

                    if (window.imageProcessor) window.imageProcessor.setPictureControl(pc);
                    if (profileImageProcessor) profileImageProcessor.setPictureControl(pc);
                    if (typeof window.updatePictureControl === "function") {
                        window.updatePictureControl({ pictureControl: pc });
                    }
                }
            } catch (err) {
                console.error("❌ Erreur d'importation NP3 :", err);
            }
        };
    }

    if (btnSaveNP3) {
        btnSaveNP3.onclick = async () => {
            try {
                const activePC = profileImageProcessor?.pictureControl || window.imageProcessor?.pictureControl;
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
                const activePC = profileImageProcessor?.pictureControl || window.imageProcessor?.pictureControl;
                if (activePC && window.electronAPI) {
                    await window.electronAPI.exportNCP(activePC);
                }
            } catch (err) {
                console.error("❌ Erreur d'exportation NCP :", err);
            }
        };
    }

    if (btnExportJpg) {
        btnExportJpg.onclick = async () => {
            try {
                const activeProcessor = window.imageProcessor || profileImageProcessor;
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

    // Afficher la bibliothèque au chargement initial
    renderNp3Library();
}

// Lancement au chargement du DOM
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initButtons);
} else {
    initButtons();
}