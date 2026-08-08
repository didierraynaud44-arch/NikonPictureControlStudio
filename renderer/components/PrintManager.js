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
        // Écoute les modifications des paramètres pour redessiner en direct
        const elements = [
            "printPaperFormat", "printCustomWidth", "printCustomHeight", 
            "printOrientation", "printZoomFill", "printAutoRotate", 
            "printMargin", "printEnableBorder", "printBorderWidth", 
            "printInfoType", "printCustomText", "printDpi", 
            "printWatermarkText", "printWatermarkPos"
        ];

        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener("change", () => this.render());
                el.addEventListener("input", () => this.render());
            }
        });

        // Afficher/masquer les champs personnalisés si "panoramique" est sélectionné
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

    async render() {
        if (!this.ctx || !this.canvas) return;

        // 1. Récupérer l'image source active depuis le Studio (soit le canvas de preview, soit l'image chargée)
        let sourceImage = null;
        const previewCanvas = document.getElementById("previewCanvas");
        if (previewCanvas && previewCanvas.width > 0) {
            sourceImage = previewCanvas;
        }

        // Dimensions de la feuille selon le format choisi
        const format = document.getElementById("printPaperFormat")?.value || "A4";
        const orientation = document.getElementById("printOrientation")?.value || "portrait";
        const dpi = parseInt(document.getElementById("printDpi")?.value) || 300;

        // Définition des dimensions en cm converties en pixels (basé sur les DPI)
        let widthCm = 21, heightCm = 29.7; // A4 par défaut

        if (format === "10x15") { widthCm = 10; heightCm = 15; }
        else if (format === "A4") { widthCm = 21; heightCm = 29.7; }
        else if (format === "A3") { widthCm = 29.7; heightCm = 42; }
        else if (format === "A3+") { widthCm = 32.9; heightCm = 48.3; }
        else if (format === "A2") { widthCm = 42; heightCm = 59.4; }
        else if (format === "panoramic") {
            widthCm = parseFloat(document.getElementById("printCustomWidth")?.value) || 32.9;
            heightCm = parseFloat(document.getElementById("printCustomHeight")?.value) || 90.0;
        }

        // Application de l'orientation
        if (orientation === "landscape") {
            let temp = widthCm; widthCm = heightCm; heightCm = temp;
        }

        // Conversion cm -> pixels pour le canvas haute résolution (DPI)
        const cmToInch = 1 / 2.54;
        const canvasWidth = Math.round(widthCm * cmToInch * dpi);
        const canvasHeight = Math.round(heightCm * cmToInch * dpi);

        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;

        // Fond blanc de la feuille
        this.ctx.fillStyle = "#ffffff";
        this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        if (!sourceImage) {
            // Si aucune image n'est chargée, on affiche un message sur la feuille
            this.ctx.fillStyle = "#888888";
            this.ctx.font = `${Math.round(dpi / 10)}px sans-serif`;
            this.ctx.textAlign = "center";
            this.ctx.fillText("Aucune image chargée", canvasWidth / 2, canvasHeight / 2);
            return;
        }

        // Récupération des options de mise en page
        const marginMm = parseFloat(document.getElementById("printMargin")?.value) || 10;
        const marginPx = Math.round((marginMm / 10) * cmToInch * dpi);
        const zoomFill = document.getElementById("printZoomFill")?.checked || false;
        const enableBorder = document.getElementById("printEnableBorder")?.checked || false;
        const borderWidth = parseInt(document.getElementById("printBorderWidth")?.value) || 2;

        // Zone imprimable disponible
        const printAreaX = marginPx;
        const printAreaY = marginPx;
        const printAreaW = canvasWidth - (marginPx * 2);
        const printAreaH = canvasHeight - (marginPx * 2);

        // Dessin de l'image avec respect du ratio
        const imgAspect = sourceImage.width / sourceImage.height;
        const areaAspect = printAreaW / printAreaH;

        let drawW, drawH, drawX, drawY;

        if (zoomFill) {
            // Mode remplissage (Crop si nécessaire)
            if (imgAspect > areaAspect) {
                drawH = printAreaH;
                drawW = drawH * imgAspect;
            } else {
                drawW = printAreaW;
                drawH = drawW / imgAspect;
            }
        } else {
            // Mode ajusté (contient toute l'image sans couper)
            if (imgAspect > areaAspect) {
                drawW = printAreaW;
                drawH = drawW / imgAspect;
            } else {
                drawH = printAreaH;
                drawW = drawH * imgAspect;
            }
        }

        drawX = printAreaX + (printAreaW - drawW) / 2;
        drawY = printAreaY + (printAreaH - drawH) / 2;

        // Sauvegarde du contexte pour le clip/dessin de l'image
        this.ctx.save();
        
        // Si zoomFill est activé, on restreint le dessin à la zone imprimable (pour couper les débords)
        if (zoomFill) {
            this.ctx.beginPath();
            this.ctx.rect(printAreaX, printAreaY, printAreaW, printAreaH);
            this.ctx.clip();
        }

        this.ctx.drawImage(sourceImage, drawX, drawY, drawW, drawH);
        this.ctx.restore();

        // Cadre / Filet autour de l'image
        if (enableBorder) {
            this.ctx.strokeStyle = "#000000";
            this.ctx.lineWidth = borderWidth * (dpi / 300); // Ajuste l'épaisseur selon le DPI
            this.ctx.strokeRect(drawX, drawY, drawW, drawH);
        }

        // Informations textuelles sous l'image (si demandé)
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
                this.ctx.fillText(textToPrint, canvasWidth / 2, drawY + drawH + Math.round(dpi / 15));
            }
        }

        // Filigrane (Watermark)
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

        // Redimensionner proprement l'affichage du canvas dans le conteneur HTML de prévisualisation
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