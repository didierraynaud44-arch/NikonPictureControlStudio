/*=========================================================
    Nikon Picture Control Studio - Controller (app.js)
=========================================================*/

let currentNefFileName = "image-editee";
let profileImageProcessor = null; // Processeur dédié au Canvas de la page profils

function initButtons() {
    // Boutons
    const btnNef           = document.getElementById("openNef");
    const btnExportJpg     = document.getElementById("exportJpg");
    const btnOpenProfiles  = document.getElementById("btnOpenProfilesPage");
    const btnReturnStudio  = document.getElementById("btnReturnToStudio");
    const btnNP3           = document.getElementById("openNP3");
    const btnSaveNP3       = document.getElementById("saveNP3");
    const btnExportNCP     = document.getElementById("exportNCP");

    // Vues et En-têtes
    const viewStudio       = document.getElementById("view-studio");
    const viewProfiles     = document.getElementById("view-profiles");
    const headerStudio     = document.getElementById("header-studio-actions");
    const headerProfiles   = document.getElementById("header-profile-actions");

    /*---------------------------------------------------------
        Navigation et synchronisation du rendu d'image
    ---------------------------------------------------------*/
/*---------------------------------------------------------
        Navigation et synchronisation du rendu d'image
    ---------------------------------------------------------*/
    if (btnOpenProfiles) {
        btnOpenProfiles.onclick = async () => {
            if (viewStudio) viewStudio.style.display = "none";
            if (headerStudio) headerStudio.style.display = "none";

            if (viewProfiles) viewProfiles.style.display = "flex";
            if (headerProfiles) headerProfiles.style.display = "flex";

            // Initialise le processeur du 2ème Canvas si nécessaire
            if (!profileImageProcessor && typeof ImageProcessor !== "undefined") {
                profileImageProcessor = new ImageProcessor("profilePreviewCanvas");
            }

            // Charge l'image actuelle dans le 2ème Canvas
            if (window.imageProcessor && window.imageProcessor.loadedImage) {
                await profileImageProcessor.load(
                    window.imageProcessor.loadedImage.src,
                    window.imageProcessor.currentOrientation
                );

                if (window.imageProcessor.pictureControl) {
                    profileImageProcessor.setPictureControl(window.imageProcessor.pictureControl);
                }
            }

            // 🎯 ASTUCE : On redirige la référence globale vers le processeur de la page 2
            window.activeProcessorBackup = window.imageProcessor;
            window.imageProcessor = profileImageProcessor;
        };
    }

    if (btnReturnStudio) {
        btnReturnStudio.onclick = () => {
            if (viewProfiles) viewProfiles.style.display = "none";
            if (headerProfiles) headerProfiles.style.display = "none";

            if (viewStudio) viewStudio.style.display = "flex";
            if (headerStudio) headerStudio.style.display = "flex";

            // Synchronise les réglages avec le Studio principal
            if (profileImageProcessor && window.activeProcessorBackup) {
                window.activeProcessorBackup.setPictureControl(profileImageProcessor.pictureControl);
            }

            // 🎯 Restauration du processeur principal pour la page 1
            if (window.activeProcessorBackup) {
                window.imageProcessor = window.activeProcessorBackup;
            }
        };
    }
    /*---------------------------------------------------------
        1. Charger une image RAW / Standard
    ---------------------------------------------------------*/
    if (btnNef) {
        btnNef.onclick = async () => {
            try {
                const fileInfo = await window.electronAPI.openNEF();
                if (fileInfo) {
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

                    if (window.updatePictureControl) {
                        window.updatePictureControl({ 
                            pictureControl: pcData, 
                            lens: fileInfo.lens || "Objectif non renseigné",
                            isNewFile: true 
                        });
                    }
                }
            } catch (err) {
                console.error("❌ Erreur ouverture NEF :", err);
            }
        };
    }

    /*---------------------------------------------------------
        2. Importer un NP3 (Applique aux deux processeurs)
    ---------------------------------------------------------*/
    if (btnNP3) {
        btnNP3.onclick = async () => {
            try {
                const response = await window.electronAPI.loadNP3();
                if (response) {
                    const pc = response.pictureControl || response.pc || response;

                    if (window.imageProcessor) window.imageProcessor.setPictureControl(pc);
                    if (profileImageProcessor) profileImageProcessor.setPictureControl(pc);

                    if (window.updatePictureControl) window.updatePictureControl({ pictureControl: pc });
                }
            } catch (err) {
                console.error("❌ Erreur import NP3 :", err);
            }
        };
    }

    /*---------------------------------------------------------
        3. Enregistrer NP3
    ---------------------------------------------------------*/
    if (btnSaveNP3) {
        btnSaveNP3.onclick = async () => {
            try {
                const activePC = profileImageProcessor?.pictureControl || window.imageProcessor?.pictureControl;
                if (!activePC) return;

                await window.electronAPI.saveNP3File(activePC);
            } catch (err) {
                console.error("❌ Erreur sauvegarde NP3 :", err);
            }
        };
    }

    /*---------------------------------------------------------
        4. Exporter NCP (Z6 II)
    ---------------------------------------------------------*/
    if (btnExportNCP) {
        btnExportNCP.onclick = async () => {
            try {
                const activePC = profileImageProcessor?.pictureControl || window.imageProcessor?.pictureControl;
                if (!activePC) return;

                await window.electronAPI.exportNCP(activePC);
            } catch (err) {
                console.error("❌ Erreur export NCP :", err);
            }
        };
    }

    /*---------------------------------------------------------
        5. Exporter l'image HD (JPG)
    ---------------------------------------------------------*/
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
                console.error("❌ Erreur exportation Image :", err);
            }
        };
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initButtons);
} else {
    initButtons();
}