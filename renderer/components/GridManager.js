/*=========================================================
    Nikon Picture Control Studio - Grid Manager
=========================================================*/

class GridManager {
    // Cache mémoire des vignettes déjà chargées dans la session (clé = chemin
    // du fichier, valeur = dataUrl), partagé par toutes les instances : évite
    // de rappeler getThumbnail si on quitte puis revient sur l'onglet Galerie.
    static thumbnailCache = new Map();

    constructor() {
        this.images = [];      // liste actuellement affichée (après filtre/tri)
        this.allImages = [];   // liste complète non filtrée du dossier courant
        this.selectedIds = new Set();

        // Note (0-5) / statut ('validated'|'rejected'|null) par chemin de fichier,
        // peuplé en un seul appel groupé à chaque rendu de grille.
        this.statusByPath = new Map();

        this.filterState = { sortBy: "name", sortDir: "asc", minRating: 0, flagFilter: "all" };

        this.btnSingle = document.getElementById("btnViewSingle");
        this.btnGrid = document.getElementById("btnViewGrid");
        this.btnBatchExport = document.getElementById("btnBatchExport");
        this.singleContainer = document.getElementById("singleImageContainer");
        this.gridContainer = document.getElementById("gridImageContainer");
        this.gridWrapper = document.getElementById("gridItemsWrapper");
        this.ratingBar = document.getElementById("ratingBar");

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
            if (this.ratingBar) this.ratingBar.style.display = "flex";
            if (this.btnSingle) this.btnSingle.classList.add("active");
            if (this.btnGrid) this.btnGrid.classList.remove("active");
            if (this.btnBatchExport) this.btnBatchExport.style.display = "none";

            if (window.imageProcessor && window.imageProcessor.display) {
                window.imageProcessor.display.requestRender();
            }
        } else {
            if (this.singleContainer) this.singleContainer.style.display = "none";
            if (this.gridContainer) this.gridContainer.style.display = "flex";
            if (this.ratingBar) this.ratingBar.style.display = "none";
            if (this.btnGrid) this.btnGrid.classList.add("active");
            if (this.btnSingle) this.btnSingle.classList.remove("active");
            this.updateExportButton();
            // Rafraîchit note/statut au cas où ils auraient été modifiés depuis la vue Photo.
            this.renderGrid();
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

    formatShortName(fileName) {
        if (!fileName) return "";

        // Simplifie les répétitions "-Modifier-Modifier..." en "_Edit"
        let cleanName = fileName.replace(/(-Modifier)+/gi, "_Edit");

        // Tronque si le nom dépasse 20 caractères tout en gardant l'extension
        if (cleanName.length > 20) {
            const extIndex = cleanName.lastIndexOf(".");
            if (extIndex !== -1) {
                const ext = cleanName.substring(extIndex);
                const base = cleanName.substring(0, extIndex);
                return base.substring(0, 13) + "..." + ext;
            }
        }

        return cleanName;
    }

    setImages(items) {
        const flatList = this._extractFiles(items);

        this.allImages = flatList.map((item, idx) => {
            const isFile = item instanceof File;
            const filePath = isFile ? item.path || item.name : item.path || item.url || item.filePath || item.name;
            const fileName = isFile ? item.name : item.name || ("Photo " + (idx + 1));

            return {
                id: "img_" + idx + "_" + Date.now(),
                rawItem: item,
                name: fileName,
                path: filePath
            };
        });

        // Ré-applique le filtre/tri courant (par défaut : aucun filtre, tri par nom)
        // sur la nouvelle liste, ce qui reconstruit this.images et appelle renderGrid().
        this.applyFilterSort(this.filterState);
    }

    // Date "déjà disponible" sur l'item (uniquement présente pour les photos
    // indexées dans le Catalogue via addFolderToCatalog ; absente pour un simple
    // dossier ouvert directement — dans ce cas le tri par date est un no-op stable).
    _getItemDate(item) {
        const raw = item.rawItem || {};
        const dateStr = raw.date || raw.date_time_original || raw.dateTimeOriginal || null;
        if (!dateStr) return 0;
        const t = new Date(dateStr).getTime();
        return Number.isFinite(t) ? t : 0;
    }

    // Filtre/trie this.allImages en mémoire (note/statut via this.statusByPath,
    // nom/date via les métadonnées déjà disponibles sur chaque item), stocke le
    // résultat dans this.images, puis redessine la grille.
    applyFilterSort(filters = {}) {
        this.filterState = {
            sortBy: filters.sortBy || "name",
            sortDir: filters.sortDir || "asc",
            minRating: Number.isFinite(filters.minRating) ? filters.minRating : 0,
            flagFilter: filters.flagFilter || "all"
        };

        const { sortBy, sortDir, minRating, flagFilter } = this.filterState;

        let filtered = this.allImages.filter((item) => {
            const status = this.statusByPath.get(item.path) || { rating: 0, flag: null };
            if (minRating > 0 && status.rating < minRating) return false;
            if (flagFilter === "validated" && status.flag !== "validated") return false;
            if (flagFilter === "rejected" && status.flag !== "rejected") return false;
            if (flagFilter === "none" && status.flag !== null) return false;
            return true;
        });

        const dir = sortDir === "desc" ? -1 : 1;
        filtered.sort((a, b) => {
            if (sortBy === "rating") {
                const ra = (this.statusByPath.get(a.path) || {}).rating || 0;
                const rb = (this.statusByPath.get(b.path) || {}).rating || 0;
                return (ra - rb) * dir;
            }
            if (sortBy === "date") {
                return (this._getItemDate(a) - this._getItemDate(b)) * dir;
            }
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * dir;
        });

        this.images = filtered;
        this.renderGrid();
    }

    _buildStarsHtml(rating) {
        let html = "";
        for (let i = 1; i <= 5; i++) {
            html += `<span class="grid-star${i <= rating ? " filled" : ""}" data-value="${i}">${i <= rating ? "★" : "☆"}</span>`;
        }
        return html;
    }

    // Bascule (ou définit) la note/le statut d'un fichier : met à jour
    // this.statusByPath localement + les éléments DOM de la carte fournie
    // (sans tout recharger), puis persiste via IPC.
    async _toggleRating(filePath, clickedValue, starEls) {
        const current = this.statusByPath.get(filePath) || { rating: 0, flag: null };
        const newRating = current.rating === clickedValue ? 0 : clickedValue;
        this.statusByPath.set(filePath, { ...current, rating: newRating });

        starEls.forEach((el, idx) => {
            const filled = (idx + 1) <= newRating;
            el.classList.toggle("filled", filled);
            el.textContent = filled ? "★" : "☆";
        });

        if (window.electronAPI && typeof window.electronAPI.setPhotoRating === "function") {
            try {
                await window.electronAPI.setPhotoRating(filePath, newRating);
            } catch (err) {
                console.error("❌ Erreur set-photo-rating:", filePath, err);
            }
        }
    }

    async _toggleFlag(filePath, clickedFlag, btnValidated, btnRejected) {
        const current = this.statusByPath.get(filePath) || { rating: 0, flag: null };
        const newFlag = current.flag === clickedFlag ? null : clickedFlag;
        this.statusByPath.set(filePath, { ...current, flag: newFlag });

        if (btnValidated) btnValidated.classList.toggle("active", newFlag === "validated");
        if (btnRejected) btnRejected.classList.toggle("active", newFlag === "rejected");

        if (window.electronAPI && typeof window.electronAPI.setPhotoFlag === "function") {
            try {
                await window.electronAPI.setPhotoFlag(filePath, newFlag);
            } catch (err) {
                console.error("❌ Erreur set-photo-flag:", filePath, err);
            }
        }
    }

    async renderGrid() {
        if (!this.gridWrapper) return;

        // Récupère en un seul appel groupé la note/le statut de toutes les photos
        // affichées (évite un aller-retour IPC par vignette).
        if (window.electronAPI && typeof window.electronAPI.getPhotosStatus === "function" && this.images.length > 0) {
            try {
                const paths = this.images.map(i => i.path).filter(Boolean);
                const statusMap = await window.electronAPI.getPhotosStatus(paths);
                paths.forEach(p => {
                    this.statusByPath.set(p, statusMap[p] || { rating: 0, flag: null });
                });
            } catch (err) {
                console.warn("⚠️ Erreur récupération note/statut des photos:", err);
            }
        }

        this.gridWrapper.innerHTML = "";

        const countSpan = document.getElementById("selectedCount");
        if (countSpan) countSpan.textContent = this.images.length;

        if (this.images.length === 0) {
            this.gridWrapper.innerHTML = '<p style="color:#777; font-size:12px; font-style:italic; grid-column: 1 / -1; text-align:center; padding: 20px;">Aucune image sélectionnée.</p>';
            return;
        }

        const fragment = document.createDocumentFragment();

        this.images.forEach(item => {
            const card = document.createElement("div");
            card.className = "grid-card " + (this.selectedIds.has(item.id) ? "selected" : "");

            const displayName = this.formatShortName(item.name);
            const status = this.statusByPath.get(item.path) || { rating: 0, flag: null };

            card.innerHTML = `
                <input type="checkbox" class="grid-checkbox" ${this.selectedIds.has(item.id) ? "checked" : ""}>
                <div class="grid-card-thumb" id="thumb_${item.id}">
                    <span class="grid-card-icon">⌛</span>
                    <span class="grid-card-name" title="${item.name}">${displayName}</span>
                </div>
                <div class="grid-card-rating-bar">
                    <div class="grid-stars">${this._buildStarsHtml(status.rating)}</div>
                    <div class="grid-card-flags">
                        <button type="button" class="grid-flag-btn grid-flag-validated${status.flag === "validated" ? " active" : ""}" title="Validée">✓</button>
                        <button type="button" class="grid-flag-btn grid-flag-rejected${status.flag === "rejected" ? " active" : ""}" title="Rejetée">✕</button>
                    </div>
                </div>
                <div class="grid-card-overlay-title" title="${item.name}">${displayName}</div>
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

            const starEls = Array.from(card.querySelectorAll(".grid-star"));
            starEls.forEach((starEl) => {
                starEl.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const value = parseInt(starEl.dataset.value, 10);
                    this._toggleRating(item.path, value, starEls);
                });
            });

            const btnValidated = card.querySelector(".grid-flag-validated");
            const btnRejected = card.querySelector(".grid-flag-rejected");
            if (btnValidated) {
                btnValidated.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this._toggleFlag(item.path, "validated", btnValidated, btnRejected);
                });
            }
            if (btnRejected) {
                btnRejected.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this._toggleFlag(item.path, "rejected", btnValidated, btnRejected);
                });
            }

            fragment.appendChild(card);
        });

        this.gridWrapper.appendChild(fragment);

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
        if (!item.path) return;

        try {
            const displayName = this.formatShortName(item.name);
            const thumbContainer = document.getElementById("thumb_" + item.id);
            if (!thumbContainer) return;

            // 0. Cache mémoire : vignette déjà chargée pendant cette session
            let imageSrc = GridManager.thumbnailCache.get(item.path) || "";

            // 1. Handler léger dédié aux vignettes (300px, pas d'EXIF, pas de ShutterCount)
            if (!imageSrc && window.electronAPI && typeof window.electronAPI.getThumbnail === "function") {
                const result = await window.electronAPI.getThumbnail(item.path);
                if (result && result.success && result.dataUrl) {
                    imageSrc = result.dataUrl;
                    GridManager.thumbnailCache.set(item.path, imageSrc);
                }
            }

            // 2. Repli direct (file://) si l'IPC a échoué
            if (!imageSrc && item.path) {
                const formattedPath = item.path.replace(/\\/g, "/");
                imageSrc = formattedPath.startsWith("/") ? "file://" + formattedPath : "file:///" + formattedPath;
            }

            if (imageSrc) {
                thumbContainer.innerHTML = `
                    <img src="${imageSrc}" alt="${item.name}" style="width:100%; height:100%; object-fit:cover;" loading="lazy">
                    <div class="grid-card-overlay-title" title="${item.name}">${displayName}</div>
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
                if (!window.electronAPI || !window.electronAPI.readFileDirect) continue;
                const fileInfo = await window.electronAPI.readFileDirect(item.path);
                if (!fileInfo) continue;

                let rawSrc = fileInfo.preview || fileInfo.filePath || fileInfo.path;
                let imageSrc = "";

                if (rawSrc) {
                    if (rawSrc.startsWith("data:") || rawSrc.startsWith("file:")) {
                        imageSrc = rawSrc;
                    } else if (/^[A-Za-z0-9+/=]+$/.test(rawSrc.toString().trim().substring(0, 100))) {
                        imageSrc = "data:image/jpeg;base64," + rawSrc.toString().trim();
                    } else {
                        const formattedPath = rawSrc.toString().replace(/\\/g, "/");
                        imageSrc = formattedPath.startsWith("/") ? "file://" + formattedPath : "file:///" + formattedPath;
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

        alert("Export terminé : " + successCount + " / " + selectedList.length + " photo(s) enregistrée(s) !");
    }
}

if (typeof window !== "undefined") {
    window.gridManager = new GridManager();
}