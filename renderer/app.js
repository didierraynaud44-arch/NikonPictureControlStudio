function initButtons() {
    const btnNef = document.getElementById("openNef");
    const btnNP3 = document.getElementById("openNP3");

    console.log("Initialisation des boutons...", { btnNef, btnNP3 });

    // 1. Charger un fichier NEF
    if (btnNef) {
        btnNef.onclick = async () => {
            console.log("📂 Clic Ouvrir NEF");
            try {
                const fileInfo = await window.electronAPI.openNEF();
                console.log("Données NEF reçues :", fileInfo);

                if (fileInfo) {
                    // 1. Mettre à jour les infos EXIF dans l'IHM
                    if (window.updateExif) {
                        window.updateExif(fileInfo);
                    }

                    // 2. Traitement intelligent du format d'image (Base64 ou Fichier)
                    let rawSrc = fileInfo.previewPath || fileInfo.preview || fileInfo.imageData || fileInfo.image || fileInfo.path;
                    let imageSrc = "";

                    if (rawSrc) {
                        if (rawSrc.startsWith("data:")) {
                            // Déjà une data-URL prête
                            imageSrc = rawSrc;
                        } else if (/^[A-Za-z0-9+/=]+$/.test(rawSrc.trim().substring(0, 100))) {
                            // C'est du Base64 brut (comme dans ta console)
                            imageSrc = `data:image/jpeg;base64,${rawSrc.trim()}`;
                        } else {
                            // C'est un chemin de fichier local sur le disque
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
                        saturation: 0
                    };

                    // 4. Chargement séquentiel dans le Canvas
                    if (imageSrc && window.imageProcessor) {
                        await window.imageProcessor.load(imageSrc);
                        window.imageProcessor.setPictureControl(pcData);
                    }

                    // 5. Mise à jour des sliders dans le panneau latéral
                    if (window.updatePictureControl) {
                        window.updatePictureControl({ pictureControl: pcData });
                    }
                }
            } catch (err) {
                console.error("Erreur ouverture NEF :", err);
            }
        };
    }

    // 2. Charger un fichier NP3
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
                console.error("Erreur import NP3 :", err);
            }
        };
    }
}

// Initialisation sécurisée
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initButtons);
} else {
    initButtons();
}