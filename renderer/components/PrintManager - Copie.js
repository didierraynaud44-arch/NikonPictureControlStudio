/*=========================================================
    Nikon Picture Control Studio - Print Manager
=========================================================*/

class PrintManager {
    constructor() {
        this.canvas = document.getElementById("printPreviewCanvas");
        this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
        
        this.initListeners();
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

        // Liaison du bouton "Lancer l'impression"
        const btnPrintExecute = document.getElementById("btnPrintExecute");
        if (btnPrintExecute) {
            btnPrintExecute.onclick = () => this.handlePrintOrPdf("print");
        }

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
     * Gère la logique de verrouillage du ratio en direct sans bloquer le 2x3 (Z6)
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
     * Prépare l'image du canvas d'impression en haute résolution et l'envoie vers Electron
     */
    async handlePrintOrPdf(actionType = "print") {
        if (!this.canvas) return;

        const dataUrl = this.canvas.toDataURL("image/jpeg", 0.95);
        const base64Data = dataUrl.split(",")[1];

        if (window.electronAPI && typeof window.electronAPI.printOrSavePdf === "function") {
            try {
                const result = await window.electronAPI.printOrSavePdf({
                    action: actionType, // "print" ou "pdf"
                    base64Data: base64Data,
                    defaultName: window.currentNefFileName || "impression-photo",
                    widthCm: parseFloat(document.getElementById("printImgWidth")?.value) || 30,
                    heightCm: parseFloat(document.getElementById("printImgHeight")?.value) || 20,
                    dpi: parseInt(document.getElementById("printDpi")?.value) || 300
                });

                if (result && !result.success && result.error) {
                    alert(`Erreur : ${result.error}`);
                }
            } catch (err) {
                console.error("❌ Erreur lors de l'action d'impression/PDF :", err);
            }
        } else {
            console.warn("⚠️ L'API Electron pour l'impression n'est pas disponible.");
        }
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

    async render() {
        if (!this.ctx || !this.canvas) return;

        let sourceImage = null;
        if (window.imageProcessor && window.imageProcessor.loadedImage) {
            sourceImage = window.imageProcessor.loadedImage;
        } else {
            const previewCanvas = document.getElementById("previewCanvas");
            if (previewCanvas && previewCanvas.width > 0) {
                sourceImage = previewCanvas;
            }
        }

        const selectedIccPath = document.getElementById("printIccProfile")?.value || "none";

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

        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;

        // 🔹 Nettoyage absolu du fond : Blanc pur garanti sur toute la surface de la feuille
        this.ctx.save();
        this.ctx.fillStyle = "#ffffff";
        this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        this.ctx.restore();

        if (!sourceImage) {
            this.ctx.fillStyle = "#888888";
            this.ctx.font = `${Math.round(dpi / 10)}px sans-serif`;
            this.ctx.textAlign = "center";
            this.ctx.fillText("Aucune image chargée", canvasWidth / 2, canvasHeight / 2);
            return;
        }

        let userImgW = parseFloat(document.getElementById("printImgWidth")?.value) || 30.0;
        let userImgH = parseFloat(document.getElementById("printImgHeight")?.value) || 20.0;

        // Sécurité : La taille demandée ne peut pas dépasser les dimensions physiques de la feuille
        if (userImgW > widthCm) userImgW = widthCm;
        if (userImgH > heightCm) userImgH = heightCm;

        // 1. LE CADRE ROUGE (Cellule cible exacte demandée par l'utilisateur en cm)
        const targetW = Math.round(userImgW * cmToInch * dpi);
        const targetH = Math.round(userImgH * cmToInch * dpi);
        const frameX = Math.round((canvasWidth - targetW) / 2);
        const frameY = Math.round((canvasHeight - targetH) / 2);

        // 2. CALCUL PROPORTIONNEL DE LA PHOTO A L'INTERIEUR DE LA CELLULE CIBLE
        const srcW = sourceImage.width || 1;
        const srcH = sourceImage.height || 1;
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

        this.ctx.save();

        if (zoomFill) {
            this.ctx.beginPath();
            this.ctx.rect(frameX, frameY, targetW, targetH);
            this.ctx.clip();
        }

        let imageToDraw = sourceImage;
        if (selectedIccPath !== "none") {
            imageToDraw = await this.applyIccSimulation(sourceImage, selectedIccPath);
            
            this.ctx.fillStyle = "rgba(88, 101, 242, 0.8)";
            this.ctx.font = `bold ${Math.round(dpi / 40)}px sans-serif`;
            this.ctx.textAlign = "left";
            this.ctx.fillText(`📄 Simulation ICC active`, frameX + 10, frameY + 30);
        }

        this.ctx.drawImage(imageToDraw, 0, 0, srcW, srcH, drawX, drawY, drawW, drawH);
        this.ctx.restore();

        this.ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
        this.ctx.lineWidth = Math.max(2, Math.round(2 * (dpi / 300)));
        this.ctx.strokeRect(frameX, frameY, targetW, targetH);

        const enableBorder = document.getElementById("printEnableBorder")?.checked || false;
        const borderWidth = parseInt(document.getElementById("printBorderWidth")?.value) || 2;
        if (enableBorder) {
            this.ctx.strokeStyle = "#000000";
            this.ctx.lineWidth = borderWidth * (dpi / 300);
            this.ctx.strokeRect(drawX, drawY, drawW, drawH);
        }

        const infoType = document.getElementById("printInfoType")?.value || "none";
        if (infoType !== "none") {
            let textToPrint = "";
            if (infoType === "filename") textToPrint = window.currentNefFileName || "photo";
            else if (infoType === "title") textToPrint = "Titre de la photo";
            else if (infoType === "caption") textToPrint = "Légende de la photo";
            else if (infoType === "date") textToPrint = new Date().toLocaleDateString();
            else if (infoType === "custom") textToPrint = document.getElementById("printCustomText")?.value || "";

            if (textToPrint) {
                this.ctx.fillStyle = "#333333";
                this.ctx.font = `${Math.round(dpi / 25)}px sans-serif`;
                this.ctx.textAlign = "center";
                this.ctx.fillText(textToPrint, canvasWidth / 2, frameY + targetH + Math.round(dpi / 15));
            }
        }

        const watermarkText = document.getElementById("printWatermarkText")?.value || "";
        const watermarkPos = document.getElementById("printWatermarkPos")?.value || "bottom-right";
        if (watermarkText) {
            this.ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
            this.ctx.font = `bold ${Math.round(dpi / 30)}px sans-serif`;
            
            let wmX = drawX + drawW - 20;
            let wmY = drawY + drawH - 20;
            this.ctx.textAlign = "right";

            if (watermarkPos === "bottom-left") { wmX = drawX + 20; wmY = drawY + drawH - 20; this.ctx.textAlign = "left"; }
            else if (watermarkPos === "top-right") { wmX = drawX + drawW - 20; wmY = drawY + 40; this.ctx.textAlign = "right"; }
            else if (watermarkPos === "top-left") { wmX = drawX + 20; wmY = drawY + 40; this.ctx.textAlign = "left"; }
            else if (watermarkPos === "center") { wmX = drawX + drawW / 2; wmY = drawY + drawH / 2; this.ctx.textAlign = "center"; }

            this.ctx.fillText(watermarkText, wmX, wmY);
        }

        const container = document.getElementById("printPreviewCanvasContainer");
        if (container) {
            const maxW = container.parentElement.clientWidth - 60;
            const maxH = container.parentElement.clientHeight - 60;
            const ratio = Math.min(maxW / canvasWidth, maxH / canvasHeight);
            
            this.canvas.style.width = Math.round(canvasWidth * ratio) + "px";
            this.canvas.style.height = Math.round(canvasHeight * ratio) + "px";
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