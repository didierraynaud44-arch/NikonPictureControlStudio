/*=========================================================
    Nikon Picture Control Studio - Print Manager
=========================================================*/

class PrintManager {
    constructor() {
        this.canvas = document.getElementById("printPreviewCanvas");
        this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
        
        // 🔹 NOUVEAU : Stockage de l'image pour l'impression
        this.currentImagePath = null;
        this.currentPictureControl = null;
        this.currentImageData = null; // Pour l'aperçu

        this.initListeners();

        // Écouter les changements d'image depuis le Studio
        window.addEventListener('imageLoadedForPrint', (e) => {
            if (e.detail && e.detail.imagePath) {
                this.setImage(e.detail.imagePath, e.detail.pictureControl);
            }
        });
    }

    /**
     * 🔹 Définit l'image à imprimer. Appelée à CHAQUE navigation dans le Studio
     * (voir app.js/loadImageInStudio) : doit rester légère et ne jamais déclencher
     * de décodage RAW pleine résolution. Ce décodage n'a lieu que quand le panneau
     * Impression est réellement affiché (switchToView -> renderPrintPreview -> render())
     * ou au moment de l'impression/export PDF (handlePrintOrPdf -> getLiveImageDataUrl).
     */
    setImage(imagePath, pictureControl = null) {
        console.log("📸 PrintManager.setImage (léger, sans décodage):", imagePath);
        this.currentImagePath = imagePath;
        this.currentPictureControl = pictureControl;
    }

    initListeners() {
        const elements = [
            "printPaperFormat", "printCustomWidth", "printCustomHeight", 
            "printOrientation", "printZoomFill",
            "printImgWidth", "printImgHeight", "printLockAspect",
            "printEnableBorder", "printBorderWidth", 
            "printInfoType", "printCustomText", "printDpi", 
            "printWatermarkText", "printWatermarkPos", "printIccProfile"
        ];

        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener("change", (e) => this.handleParamChange(id, e));
                el.addEventListener("input", (e) => this.handleParamChange(id, e));
            }
        });

        // 🔹 MODIFIÉ : Liaison du bouton "Lancer l'impression"
        const btnPrintExecute = document.getElementById("btnPrintExecute");
        if (btnPrintExecute) {
            btnPrintExecute.onclick = () => {
                if (!this.currentImagePath) {
                    alert("⚠️ Aucune image chargée dans le Studio");
                    return;
                }
                this.handlePrintOrPdf("print");
            };
        }

        // 🔹 MODIFIÉ : Bouton "Lancer l'impression" (version alternative)
        const btnPrintExecuteAlt = document.getElementById("btnPrintExecuteAlt");
        if (btnPrintExecuteAlt) {
            btnPrintExecuteAlt.onclick = () => {
                if (!this.currentImagePath) {
                    alert("⚠️ Aucune image chargée dans le Studio");
                    return;
                }
                this.handlePrintOrPdf("print");
            };
        }

        // 🔹 MODIFIÉ : Bouton "Exporter PDF"
        const btnExportPdf = document.getElementById("btnExportPdf");
        if (btnExportPdf) {
            btnExportPdf.onclick = () => {
                if (!this.currentImagePath) {
                    alert("⚠️ Aucune image chargée dans le Studio");
                    return;
                }
                this.handlePrintOrPdf("pdf");
            };
        }

        // Gestion des formats personnalisés
        const paperFormat = document.getElementById("printPaperFormat");
        const customGroup = document.getElementById("printCustomSizeGroup");
        const infoType = document.getElementById("printInfoType");
        const customText = document.getElementById("printCustomText");

        if (paperFormat && customGroup) {
            paperFormat.addEventListener("change", () => {
                customGroup.style.display = (paperFormat.value === "panoramic") ? "block" : "none";
                this.render();
            });
        }

        if (infoType && customText) {
            infoType.addEventListener("change", () => {
                customText.style.display = (infoType.value === "custom") ? "block" : "none";
                this.render();
            });
        }
    }

    /**
     * Gère la logique de verrouillage du ratio
     */
    handleParamChange(changedId) {
        const lockAspect = document.getElementById("printLockAspect")?.checked;
        const widthInput = document.getElementById("printImgWidth");
        const heightInput = document.getElementById("printImgHeight");

        const previewCanvas = document.getElementById("previewCanvas");
        if (lockAspect && previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0) {
            let imgAspect = previewCanvas.width / previewCanvas.height;
            
            if (Math.abs(imgAspect - 1.5) < 0.05) imgAspect = 1.5; 
            else if (Math.abs(imgAspect - (2/3)) < 0.05) imgAspect = 2 / 3;

            if (changedId === "printImgWidth" && widthInput) {
                let w = parseFloat(widthInput.value) || 20;
                let h = parseFloat((w / 1.5).toFixed(1)); 
                if (heightInput && parseFloat(heightInput.value) !== h) {
                    heightInput.value = h;
                }
            } else if (changedId === "printImgHeight" && heightInput) {
                let h = parseFloat(heightInput.value) || 20;
                let w = parseFloat((h * 1.5).toFixed(1));
                if (widthInput && parseFloat(widthInput.value) !== w) {
                    widthInput.value = w;
                }
            }
        }

        this.render();
    }

    /**
     * 🔹 MODIFIÉ : Prépare l'image et l'envoie vers Electron
     */
    async handlePrintOrPdf(actionType = "print") {
    if (!this.currentImagePath) {
        alert("Aucune image chargée");
        return;
    }

    // Récupérer les dimensions
    let widthCm = parseFloat(document.getElementById("printImgWidth")?.value) || 15;
    let heightCm = parseFloat(document.getElementById("printImgHeight")?.value) || 10;
    
    // 🔥 LIMITER LES DIMENSIONS MAXIMUM
    const MAX_CM = 100;
    if (widthCm > MAX_CM) {
        widthCm = MAX_CM;
        document.getElementById("printImgWidth").value = MAX_CM;
        console.log(`⚠️ Largeur limitée à ${MAX_CM}cm`);
    }
    if (heightCm > MAX_CM) {
        heightCm = MAX_CM;
        document.getElementById("printImgHeight").value = MAX_CM;
        console.log(`⚠️ Hauteur limitée à ${MAX_CM}cm`);
    }

        // 🔹 NOUVEAU : récupérer l'image AU MOMENT DE L'IMPRESSION, avec les réglages actuels
        const liveImageDataUrl = await this.getLiveImageDataUrl();
        if (!liveImageDataUrl) {
            alert("❌ Impossible de récupérer l'image traitée. Vérifiez qu'une photo est bien chargée dans le Studio.");
            return;
        }

        // Récupérer tous les paramètres d'impression
        const params = {
            action: actionType,
            imagePath: this.currentImagePath,
            imageDataUrl: liveImageDataUrl,
            pictureControl: this.currentPictureControl,
            defaultName: this.currentImagePath ?
                this.currentImagePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : 
                "impression-photo",
            widthCm: parseFloat(document.getElementById("printImgWidth")?.value) || 15,
            heightCm: parseFloat(document.getElementById("printImgHeight")?.value) || 10,
            dpi: parseInt(document.getElementById("printDpi")?.value) || 300,
            format: document.getElementById("printPaperFormat")?.value || "A4",
            orientation: document.getElementById("printOrientation")?.value || "portrait",
            zoomFill: document.getElementById("printZoomFill")?.checked || false,
            enableBorder: document.getElementById("printEnableBorder")?.checked || false,
            borderWidth: parseInt(document.getElementById("printBorderWidth")?.value) || 2,
            infoType: document.getElementById("printInfoType")?.value || "none",
            customText: document.getElementById("printCustomText")?.value || "",
            watermarkText: document.getElementById("printWatermarkText")?.value || "",
            watermarkPos: document.getElementById("printWatermarkPos")?.value || "bottom-right",
            iccProfile: document.getElementById("printIccProfile")?.value || "none"
        };

        console.log("📤 Envoi impression:", params);

        try {
            if (window.electronAPI && typeof window.electronAPI.printOrSavePdf === "function") {
                const result = await window.electronAPI.printOrSavePdf(params);
                if (result && !result.success && result.error) {
                    alert(`❌ Erreur : ${result.error}`);
                } else if (result && result.success) {
                    console.log("✅ Impression/PDF réussi");
                }
            } else {
                console.warn("⚠️ L'API Electron pour l'impression n'est pas disponible.");
                alert("⚠️ L'API d'impression n'est pas disponible");
            }
        } catch (err) {
            console.error("❌ Erreur lors de l'action d'impression/PDF :", err);
            alert(`❌ Erreur : ${err.message}`);
        }
    }

    /**
     * 🔹 NOUVEAU : Récupère l'image ACTUELLE, avec tous les réglages appliqués.
     * Utilise la même source que l'export JPEG (window.imageProcessor.exportFullResolution),
     * qui rend l'image traitée à sa résolution réelle, sans marge ni fond autour.
     * ⚠️ Ne PAS utiliser previewCanvas.toDataURL() directement en source principale :
     * ce canvas d'affichage peut contenir des marges/un fond autour de la photo,
     * ce qui imprimerait "toute la page" au lieu de la photo seule.
     */
    async getLiveImageDataUrl() {
        if (window.imageProcessor && typeof window.imageProcessor.exportFullResolution === "function") {
            if (typeof showRawDecodingIndicator === "function") showRawDecodingIndicator(true);
            try {
                const dataUrl = await window.imageProcessor.exportFullResolution(this.currentImagePath, 1, "image/jpeg");
                if (dataUrl) {
                    console.log("✅ Image à jour récupérée via exportFullResolution (avec réglages)");
                    return dataUrl;
                }
            } catch (e) {
                console.warn("⚠️ exportFullResolution a échoué:", e);
            } finally {
                if (typeof showRawDecodingIndicator === "function") showRawDecodingIndicator(false);
            }
        }

        // Repli de dernier recours seulement : le canvas d'aperçu du Studio.
        // Attention : peut contenir des marges/un fond → risque d'imprimer "toute la page".
        const previewCanvas = document.getElementById("previewCanvas");
        if (previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0) {
            console.warn("⚠️ Repli sur previewCanvas.toDataURL() : exportFullResolution indisponible. " +
                "Risque d'imprimer le canvas entier (marges incluses) plutôt que la photo seule.");
            return previewCanvas.toDataURL("image/jpeg", 0.95);
        }

        return null;
    }

    /**
     * Simulation ICC Fine Art
     */
    async applyIccSimulation(sourceImage, iccPath) {
        if (!iccPath || iccPath === "none") return sourceImage;

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = sourceImage.width;
        tempCanvas.height = sourceImage.height;
        const tempCtx = tempCanvas.getContext("2d");
        
        tempCtx.drawImage(sourceImage, 0, 0);
        const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
            data[i]     = Math.min(255, data[i] * 0.98 + 5);       
            data[i + 1] = Math.min(255, data[i + 1] * 0.98 + 5);   
            data[i + 2] = Math.min(255, data[i + 2] * 0.98 + 5);   
        }

        tempCtx.putImageData(imgData, 0, 0);
        return tempCanvas;
    }

    /**
     * 🔹 MODIFIÉ : Rendu de l'aperçu
     */
    async render() {
        if (!this.ctx || !this.canvas) return;

        // Si pas d'image, afficher un message
        if (!this.currentImagePath) {
            this.ctx.fillStyle = "#f0f0f0";
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = "#888888";
            this.ctx.font = "20px sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.fillText("📸 Charger une image dans le Studio", this.canvas.width/2, this.canvas.height/2);
            return;
        }

        try {
            // 🔹 MODIFIÉ : utiliser en priorité l'image traitée ET à jour (mêmes réglages
            // que ceux visibles dans le Studio à l'instant présent), pas une version figée
            // au moment du chargement du fichier.
            let imageData = await this.getLiveImageDataUrl();

            // Repli : recharger depuis le disque via Electron (image brute, réglages non garantis à jour)
            if (!imageData && window.electronAPI && typeof window.electronAPI.loadImageForPrint === "function") {
                console.warn("⚠️ Repli sur loadImageForPrint (Electron) : l'image peut ne pas refléter les derniers réglages.");
                const result = await window.electronAPI.loadImageForPrint(
                    this.currentImagePath,
                    this.currentPictureControl
                );
                if (result && result.success) {
                    imageData = result.data;
                }
            }

            if (!imageData) {
                throw new Error("Impossible de charger l'image");
            }

            // Créer une image à partir des données
            const img = new Image();
            img.src = imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;
            
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });

            // Dimensions de la feuille
            const format = document.getElementById("printPaperFormat")?.value || "A4";
            const orientation = document.getElementById("printOrientation")?.value || "portrait";
            const dpi = parseInt(document.getElementById("printDpi")?.value) || 300;

            let widthCm = 21, heightCm = 29.7;

            if (format === "10x15") { widthCm = 10; heightCm = 15; }
            else if (format === "A4") { widthCm = 21; heightCm = 29.7; }
            else if (format === "A3") { widthCm = 29.7; heightCm = 42; }
            else if (format === "A3+") { widthCm = 32.9; heightCm = 48.3; }
            else if (format === "A2") { widthCm = 42; heightCm = 59.4; }
            else if (format === "panoramic") {
                widthCm = parseFloat(document.getElementById("printCustomWidth")?.value) || 32.9;
                heightCm = parseFloat(document.getElementById("printCustomHeight")?.value) || 90.0;
            }

            if (orientation === "landscape") {
                let temp = widthCm; widthCm = heightCm; heightCm = temp;
            }

            const cmToInch = 1 / 2.54;
            const canvasWidth = Math.round(widthCm * cmToInch * dpi);
            const canvasHeight = Math.round(heightCm * cmToInch * dpi);

            // Limiter la taille du canvas d'aperçu
            const maxPreviewSize = 2000;
            let previewWidth = canvasWidth;
            let previewHeight = canvasHeight;
            if (previewWidth > maxPreviewSize || previewHeight > maxPreviewSize) {
                const ratio = Math.min(maxPreviewSize / previewWidth, maxPreviewSize / previewHeight);
                previewWidth = Math.round(previewWidth * ratio);
                previewHeight = Math.round(previewHeight * ratio);
            }

            this.canvas.width = previewWidth;
            this.canvas.height = previewHeight;

            // Fond blanc
            this.ctx.fillStyle = "#ffffff";
            this.ctx.fillRect(0, 0, previewWidth, previewHeight);

            // Calculer la taille de l'image
            const userImgW = parseFloat(document.getElementById("printImgWidth")?.value) || 15;
            const userImgH = parseFloat(document.getElementById("printImgHeight")?.value) || 10;
            
            const targetW = Math.round(userImgW / widthCm * previewWidth);
            const targetH = Math.round(userImgH / heightCm * previewHeight);
            const frameX = Math.round((previewWidth - targetW) / 2);
            const frameY = Math.round((previewHeight - targetH) / 2);

            const srcW = img.width || 1;
            const srcH = img.height || 1;
            const imgAspect = srcW / srcH;
            const targetAspect = targetW / targetH;

            let drawW = targetW;
            let drawH = targetH;
            const zoomFill = document.getElementById("printZoomFill")?.checked || false;

            if (zoomFill) {
                if (imgAspect > targetAspect) {
                    drawH = targetH;
                    drawW = drawH * imgAspect;
                } else {
                    drawW = targetW;
                    drawH = drawW / imgAspect;
                }
            } else {
                if (imgAspect > targetAspect) {
                    drawW = targetW;
                    drawH = drawW / imgAspect;
                } else {
                    drawH = targetH;
                    drawW = drawH * imgAspect;
                }
            }

            const drawX = frameX + Math.round((targetW - drawW) / 2);
            const drawY = frameY + Math.round((targetH - drawH) / 2);

            // Dessiner l'image
            this.ctx.save();
            if (zoomFill) {
                this.ctx.beginPath();
                this.ctx.rect(frameX, frameY, targetW, targetH);
                this.ctx.clip();
            }
            this.ctx.drawImage(img, drawX, drawY, drawW, drawH);
            this.ctx.restore();

            // Cadre rouge
            this.ctx.strokeStyle = "rgba(255, 0, 0, 0.6)";
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(frameX, frameY, targetW, targetH);

            // Bordure
            const enableBorder = document.getElementById("printEnableBorder")?.checked || false;
            if (enableBorder) {
                const borderWidth = parseInt(document.getElementById("printBorderWidth")?.value) || 2;
                this.ctx.strokeStyle = "#000000";
                this.ctx.lineWidth = borderWidth * (dpi / 300) * (previewWidth / canvasWidth);
                this.ctx.strokeRect(drawX, drawY, drawW, drawH);
            }

            // Filigrane
            const watermarkText = document.getElementById("printWatermarkText")?.value || "";
            if (watermarkText) {
                this.ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
                this.ctx.font = `bold ${Math.round(Math.min(previewWidth, previewHeight) / 30)}px sans-serif`;
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";
                this.ctx.fillText(watermarkText, previewWidth / 2, previewHeight / 2);
            }

            // Redimensionner l'affichage du canvas
            const container = document.getElementById("printPreviewCanvasContainer");
            if (container) {
                const maxW = container.parentElement.clientWidth - 40;
                const maxH = container.parentElement.clientHeight - 40;
                const ratio = Math.min(maxW / previewWidth, maxH / previewHeight);
                this.canvas.style.width = Math.round(previewWidth * ratio) + "px";
                this.canvas.style.height = Math.round(previewHeight * ratio) + "px";
            }

        } catch (err) {
            console.error("❌ Erreur rendu impression:", err);
            this.ctx.fillStyle = "#f0f0f0";
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = "#cc3333";
            this.ctx.font = "16px sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.fillText(`❌ Erreur: ${err.message}`, this.canvas.width/2, this.canvas.height/2);
        }
    }
}

// Initialisation globale
if (typeof window !== "undefined") {
    window.printManager = new PrintManager();
    window.renderPrintPreview = () => {
        if (window.printManager) window.printManager.render();
    };
}