/*=========================================================
    Nikon Picture Control Studio - Controller (app.js)
=========================================================*/

function initButtons() {
    const btnNef = document.getElementById("openNef");
    const btnNP3 = document.getElementById("openNP3");
    const btnSaveNP3 = document.getElementById("saveNP3");
    const btnExportJpg = document.getElementById("exportJpg");

    console.log("🚀 Initialisation des boutons...", { 
        btnNef: !!btnNef, 
        btnNP3: !!btnNP3, 
        btnSaveNP3: !!btnSaveNP3, 
        btnExportJpg: !!btnExportJpg 
    });

    /*---------------------------------------------------------
        1. Charger un fichier NEF
    ---------------------------------------------------------*/
    if (btnNef) {
        btnNef.onclick = async () => {
            console.log("📂 Clic Ouvrir NEF");
            try {
                const fileInfo = await window.electronAPI.openNEF();
                console.log("Données NEF reçues :", fileInfo);

                if (fileInfo) {
                    // 1. Mettre à jour les infos EXIF dans l'IHM
                    if (typeof window.updateExif === "function") {
                        window.updateExif(fileInfo);
                    } else {
                        // FALLBACK DIRECT : Si window.updateExif n'existe pas
                        const cameraEl = document.getElementById("exifCamera") || document.getElementById("camera-info");
                        const lensEl   = document.getElementById("exifLens")   || document.getElementById("lens-info");
                        const paramsEl = document.getElementById("exifParams") || document.getElementById("settings-info");

                        if (cameraEl) cameraEl.textContent = `${fileInfo.make || ''} ${fileInfo.model || ''}`.trim();
                        if (lensEl)   lensEl.textContent   = fileInfo.lens || "Objectif non renseigné";
                        if (paramsEl) {
                            const details = [fileInfo.focal, fileInfo.aperture, fileInfo.shutter, fileInfo.iso ? `ISO ${fileInfo.iso}` : ""]
                                .filter(Boolean)
                                .join(" | ");
                            paramsEl.textContent = details;
                        }
                    }

                    // 2. Traitement du format d'image (Base64 ou Chemin local)
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

                    console.log("🔗 Source transmise au Canvas :", imageSrc.substring(0, 60) + "...");

                    // 3. Extraction du Picture Control
                    const pcData = fileInfo.pictureControl || fileInfo.pc || {
                        sharpening: 3.25,
                        midRangeSharpening: 1.0,
                        clarity: 1.0,
                        contrast: 0,
                        highlights: 0,
                        shadows: 0,
                        saturation: 0,
                        toneCurve: 0,
                        hue: 0,
                        colorGrading: 0
                    };

                    // 4. Chargement dans le Canvas & application des filtres (AVEC ROTATION EXIF)
                    if (imageSrc && window.imageProcessor) {
                        // 🎯 Transmettre fileInfo.orientation pour redresser les portraits
                        await window.imageProcessor.load(imageSrc, fileInfo.orientation || 1);
                        window.imageProcessor.setPictureControl(pcData);
                    }

                    // 5. Mise à jour des sliders dans le panneau latéral
                    if (window.updatePictureControl) {
                        window.updatePictureControl({ pictureControl: pcData, isNewFile: true });
                    }
                }
            } catch (err) {
                console.error("❌ Erreur ouverture NEF :", err);
            }
        };
    }

    /*---------------------------------------------------------
        2. Importer un fichier NP3
    ---------------------------------------------------------*/
    if (btnNP3) {
        btnNP3.onclick = async () => {
            console.log("🎛️ Clic Importer NP3");
            try {
                const response = await window.electronAPI.loadNP3();
                console.log("Données NP3 reçues :", response);

                if (response) {
                    const pc = response.pictureControl || response.pc || response;

                    if (window.imageProcessor) {
                        window.imageProcessor.setPictureControl(pc);
                    }

                    if (window.updatePictureControl) {
                        window.updatePictureControl({ pictureControl: pc });
                    }
                }
            } catch (err) {
                console.error("❌ Erreur import NP3 :", err);
            }
        };
    }

    /*---------------------------------------------------------
        3. Sauvegarder le fichier NP3 modifié
    ---------------------------------------------------------*/
    if (btnSaveNP3) {
        btnSaveNP3.onclick = async () => {
            console.log("💾 Clic Sauvegarder NP3");
            try {
                if (!window.imageProcessor || !window.imageProcessor.pictureControl) {
                    console.warn("⚠️ Aucun Picture Control à sauvegarder.");
                    return;
                }

                const currentSettings = window.imageProcessor.pictureControl;
                
                if (window.electronAPI && window.electronAPI.saveNP3File) {
                    const saved = await window.electronAPI.saveNP3File(currentSettings);
                    if (saved) {
                        console.log("✅ Fichier NP3 enregistré avec succès !");
                    }
                } else {
                    console.error("❌ Méthode saveNP3File introuvable dans electronAPI.");
                }
            } catch (err) {
                console.error("❌ Erreur sauvegarde NP3 :", err);
            }
        };
    }

    /*---------------------------------------------------------
        4. Exporter en JPG Haute Résolution
    ---------------------------------------------------------*/
    if (btnExportJpg) {
        btnExportJpg.onclick = async () => {
            console.log("📸 Clic Exporter JPG HD");
            try {
                if (!window.imageProcessor) {
                    console.warn("⚠️ Moteur de rendu indisponible.");
                    return;
                }

                // Génère le rendu sur le buffer pleine résolution (originalRawBuffer)
                const base64Data = await window.imageProcessor.exportJPEG(0.95);
                
                if (base64Data && window.electronAPI && window.electronAPI.saveJPEGFile) {
                    const saved = await window.electronAPI.saveJPEGFile(base64Data);
                    if (saved) {
                        console.log("✅ Photo JPEG exportée avec succès !");
                    }
                } else {
                    console.error("❌ Impossible de sauvegarder le JPEG (DataURL vide ou API manquante).");
                }
            } catch (err) {
                console.error("❌ Erreur exportation JPG :", err);
            }
        };
    }
}

/*=========================================================
    Initialisation au chargement de la page
=========================================================*/
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initButtons);
} else {
    initButtons();
}