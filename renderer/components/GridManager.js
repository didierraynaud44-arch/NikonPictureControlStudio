/*=========================================================
    Nikon Picture Control Studio - Grid Manager
=========================================================*/

class GridManager {
    constructor() {
        this.images = [];
        this.selectedIds = new Set();
        
        this.btnSingle = document.getElementById("btnViewSingle");
        this.btnGrid = document.getElementById("btnViewGrid");
        this.btnBatchExport = document.getElementById("btnBatchExport");
        this.singleContainer = document.getElementById("singleImageContainer");
        this.gridContainer = document.getElementById("gridImageContainer");
        this.gridWrapper = document.getElementById("gridItemsWrapper");

        this.initUI();
    }

    initUI() {
        if (this.btnSingle) {
            this.btnSingle.addEventListener("click", () => this.switchMode("single"));
        }
        if (this.btnGrid) {
            this.btnGrid.addEventListener("click", () => this.switchMode("grid"));
        }

        if (this.btnBatchExport) {
            this.btnBatchExport.addEventListener("click", () => {
                const modal = document.getElementById("exportModal");
                if (modal) modal.style.display = "flex";
            });
        }

        const closeBtn = document.getElementById("btnCloseExportModal");
        const modal = document.getElementById("exportModal");
        if (closeBtn && modal) {
            closeBtn.addEventListener("click", () => {
                modal.style.display = "none";
            });
        }
    }

    switchMode(mode) {
        if (mode === "single") {
            if (this.singleContainer) this.singleContainer.style.display = "flex";
            if (this.gridContainer) this.gridContainer.style.display = "none";
            if (this.btnSingle) this.btnSingle.classList.add("active");
            if (this.btnGrid) this.btnGrid.classList.remove("active");
            if (this.btnBatchExport) this.btnBatchExport.style.display = "none";
            
            if (window.imageProcessor && window.imageProcessor.display) {
                window.imageProcessor.display.requestRender();
            }
        } else {
            if (this.singleContainer) this.singleContainer.style.display = "none";
            if (this.gridContainer) this.gridContainer.style.display = "flex";
            if (this.btnGrid) this.btnGrid.classList.add("active");
            if (this.btnSingle) this.btnSingle.classList.remove("active");
            this.updateExportButton();
        }
    }

    _extractFiles(items) {
        let fileList = [];
        if (!items) return fileList;

        const processNode = (node) => {
            if (!node) return;
            if (Array.isArray(node)) {
                node.forEach(processNode);
                return;
            }
            if (node.files && Array.isArray(node.files)) {
                fileList = fileList.concat(node.files);
            }
            if (node.children && Array.isArray(node.children)) {
                node.children.forEach(processNode);
            }
            if (node.path || node.name) {
                if (!node.children && !node.files) {
                    fileList.push(node);
                }
            }
        };

        processNode(items);
        return fileList;
    }

    setImages(items) {
        const flatList = this._extractFiles(items);

        this.images = flatList.map((item, idx) => {
            const isFile = item instanceof File;
            const filePath = isFile ? item.path || item.name : item.path || item.url || item.filePath || item.name;
            const fileName = isFile ? item.name : item.name || `Photo ${idx + 1}`;

            return {
                id: `img_${idx}_${Date.now()}`,
                rawItem: item,
                name: fileName,
                path: filePath
            };
        });

        this.renderGrid();
    }

    renderGrid() {
        if (!this.gridWrapper) return;
        this.gridWrapper.innerHTML = "";

        const countSpan = document.getElementById("selectedCount");
        if (countSpan) countSpan.textContent = this.images.length;

        if (this.images.length === 0) {
            this.gridWrapper.innerHTML = `<p style="color:#777; font-size:12px; font-style:italic; grid-column: 1 / -1; text-align:center; padding: 20px;">Aucune image sélectionnée.</p>`;
            return;
        }

        const fragment = document.createDocumentFragment();

        this.images.forEach(item => {
            const card = document.createElement("div");
            card.className = `grid-card ${this.selectedIds.has(item.id) ? "selected" : ""}`;

            card.innerHTML = `
                <input type="checkbox" class="grid-checkbox" ${this.selectedIds.has(item.id) ? "checked" : ""}>
                <div class="grid-card-thumb" id="thumb_${item.id}">
                    <span class="grid-card-icon">⌛</span>
                    <span class="grid-card-name">${item.name}</span>
                </div>
            `;

            const checkbox = card.querySelector(".grid-checkbox");

            card.addEventListener("click", (e) => {
                if (e.target !== checkbox) {
                    if (typeof window.loadImageInStudio === "function") {
                        window.loadImageInStudio(item.path);
                        this.switchMode("single");
                    }
                }
            });

            checkbox.addEventListener("change", (e) => {
                e.stopPropagation();
                if (checkbox.checked) {
                    this.selectedIds.add(item.id);
                    card.classList.add("selected");
                } else {
                    this.selectedIds.delete(item.id);
                    card.classList.remove("selected");
                }
                this.updateExportButton();
            });

            fragment.appendChild(card);
        });

        this.gridWrapper.appendChild(fragment);

        // Chargement parallèle par lots de 6 images
        this._loadThumbnailsInBatch();
    }

    async _loadThumbnailsInBatch() {
        const batchSize = 6;
        for (let i = 0; i < this.images.length; i += batchSize) {
            const batch = this.images.slice(i, i + batchSize);
            await Promise.all(batch.map(item => this._loadThumbnail(item)));
        }
    }

    async _loadThumbnail(item) {
        if (!item.path || !window.electronAPI?.readFileDirect) return;

        try {
            const fileInfo = await window.electronAPI.readFileDirect(item.path);
            const thumbContainer = document.getElementById(`thumb_${item.id}`);
            if (!thumbContainer || !fileInfo) return;

            let rawSrc = fileInfo.preview || fileInfo.filePath || fileInfo.path;
            let imageSrc = "";

            if (rawSrc) {
                if (rawSrc.startsWith("data:") || rawSrc.startsWith("file:")) {
                    imageSrc = rawSrc;
                } else if (/^[A-Za-z0-9+/=]+$/.test(rawSrc.toString().trim().substring(0, 100))) {
                    imageSrc = `data:image/jpeg;base64,${rawSrc.toString().trim()}`;
                } else {
                    const formattedPath = rawSrc.toString().replace(/\\/g, "/");
                    imageSrc = formattedPath.startsWith("/") ? `file://${formattedPath}` : `file:///${formattedPath}`;
                }
            }

            if (imageSrc) {
                thumbContainer.innerHTML = `
                    <img src="${imageSrc}" alt="${item.name}" style="width:100%; height:100%; object-fit:cover;" loading="lazy">
                    <div class="grid-card-overlay-title">${item.name}</div>
                `;
            }
        } catch (err) {
            console.error("Erreur chargement miniature :", item.path, err);
        }
    }

    updateExportButton() {
        if (this.btnBatchExport) {
            this.btnBatchExport.style.display = this.selectedIds.size > 0 ? "inline-block" : "none";
        }
    }

    async exportSelectedImages(config) {
        const selectedList = this.images.filter(img => this.selectedIds.has(img.id));
        if (selectedList.length === 0) return;

        let successCount = 0;

        for (const item of selectedList) {
            try {
                if (!window.electronAPI?.readFileDirect) continue;
                const fileInfo = await window.electronAPI.readFileDirect(item.path);
                if (!fileInfo) continue;

                let rawSrc = fileInfo.preview || fileInfo.filePath || fileInfo.path;
                let imageSrc = "";

                if (rawSrc) {
                    if (rawSrc.startsWith("data:") || rawSrc.startsWith("file:")) {
                        imageSrc = rawSrc;
                    } else if (/^[A-Za-z0-9+/=]+$/.test(rawSrc.toString().trim().substring(0, 100))) {
                        imageSrc = `data:image/jpeg;base64,${rawSrc.toString().trim()}`;
                    } else {
                        const formattedPath = rawSrc.toString().replace(/\\/g, "/");
                        imageSrc = formattedPath.startsWith("/") ? `file://${formattedPath}` : `file:///${formattedPath}`;
                    }
                }

                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = imageSrc;
                });

                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = config.width || img.width;
                tempCanvas.height = config.height || img.height;
                const ctx = tempCanvas.getContext("2d");
                ctx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);

                const dataUrl = tempCanvas.toDataURL(config.format, config.quality);
                const base64Data = dataUrl.split(",")[1];
                const fileName = item.name.replace(/\.[^/.]+$/, "");

                const saveFunc = window.electronAPI.saveImageFile || window.electronAPI.saveJPEG;
                if (saveFunc) {
                    const res = await saveFunc({
                        defaultName: fileName,
                        base64Data: base64Data,
                        exportConfig: config,
                        silent: true
                    });
                    if (res && (res.success || res === true)) {
                        successCount++;
                    }
                }
            } catch (err) {
                console.error("❌ Erreur export batch :", item.name, err);
            }
        }

        alert(`Export terminé : ${successCount} / ${selectedList.length} photo(s) enregistrée(s) !`);
    }
}

if (typeof window !== "undefined") {
    window.gridManager = new GridManager();
}