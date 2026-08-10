/*=========================================================
    Nikon Picture Control Studio - Catalog Renderer
    Version avec EXIF depuis la base de données
=========================================================*/

let selectedFolderPath = null;
let currentPhotos = []; // Cache pour les photos

// ============================================================
// API CATALOGUE - Interface entre le renderer et la base
// ============================================================

window.catalogAPI = {
    /**
     * Récupère tous les dossiers du catalogue
     */
    getFolders: async () => {
        try {
            if (window.electronAPI && typeof window.electronAPI.getCatalogFolders === "function") {
                return await window.electronAPI.getCatalogFolders();
            }
            return [];
        } catch (err) {
            console.error("❌ Erreur getFolders:", err);
            return [];
        }
    },

    /**
     * Récupère les photos d'un dossier (ou toutes)
     */
    getPhotos: async (folderPath) => {
        try {
            if (window.electronAPI && typeof window.electronAPI.getCatalogPhotos === "function") {
                const photos = await window.electronAPI.getCatalogPhotos(folderPath);
                currentPhotos = photos;
                return photos;
            }
            return [];
        } catch (err) {
            console.error("❌ Erreur getPhotos:", err);
            return [];
        }
    },

    /**
     * 🔥 Récupère une photo par son chemin (NOUVEAU)
     */
    getPhotoByPath: async (filePath) => {
        try {
            // D'abord chercher dans le cache
            if (currentPhotos && currentPhotos.length > 0) {
                const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
                const photo = currentPhotos.find(p => {
                    const pPath = (p.file_path || '').replace(/\\/g, '/').toLowerCase();
                    return pPath === normalizedPath;
                });
                if (photo) return photo;
            }

            // Si pas dans le cache, demander à Electron
            if (window.electronAPI && typeof window.electronAPI.getPhotoByPath === "function") {
                return await window.electronAPI.getPhotoByPath(filePath);
            }
            
            return null;
        } catch (err) {
            console.error("❌ Erreur getPhotoByPath:", err);
            return null;
        }
    },

    /**
     * Sélectionne un dossier à importer
     */
    selectFolder: async () => {
        try {
            if (window.electronAPI && typeof window.electronAPI.selectCatalogFolder === "function") {
                return await window.electronAPI.selectCatalogFolder();
            }
            return null;
        } catch (err) {
            console.error("❌ Erreur selectFolder:", err);
            return null;
        }
    },

    /**
     * Indexe un dossier
     */
    indexFolder: async (folderPath) => {
        try {
            if (window.electronAPI && typeof window.electronAPI.indexCatalogFolder === "function") {
                return await window.electronAPI.indexCatalogFolder(folderPath);
            }
            return null;
        } catch (err) {
            console.error("❌ Erreur indexFolder:", err);
            return null;
        }
    },

    /**
     * Écoute la progression du scan
     */
    onScanProgress: (callback) => {
        if (window.electronAPI && typeof window.electronAPI.onCatalogScanProgress === "function") {
            window.electronAPI.onCatalogScanProgress(callback);
        }
    }
};

// ============================================================
// AFFICHAGE DES DOSSIERS
// ============================================================

async function refreshFolders() {
    const folderListEl = document.getElementById('folder-list');
    if (!folderListEl || !window.catalogAPI) return;

    const folders = await window.catalogAPI.getFolders();
    
    folderListEl.innerHTML = `
        <div class="folder-item ${selectedFolderPath === null ? 'active' : ''}" data-path="ALL">
            📁 Tous les dossiers (${folders.length})
        </div>
    `;

    folders.forEach(folder => {
        const item = document.createElement('div');
        item.className = `folder-item ${selectedFolderPath === folder.folder_path ? 'active' : ''}`;
        item.textContent = `📁 ${folder.folder_name}`;
        
        item.addEventListener('click', () => {
            selectedFolderPath = folder.folder_path;
            refreshFolders();
            refreshGrid();
        });

        folderListEl.appendChild(item);
    });

    const allBtn = folderListEl.querySelector('[data-path="ALL"]');
    if (allBtn) {
        allBtn.addEventListener('click', () => {
            selectedFolderPath = null;
            refreshFolders();
            refreshGrid();
        });
    }
}

// ============================================================
// AFFICHAGE DE LA GRILLE AVEC EXIF
// ============================================================

async function refreshGrid() {
    const grid = document.getElementById('grid');
    const stats = document.getElementById('stats') || document.getElementById('catalog-stats');
    if (!grid || !window.catalogAPI) return;

    grid.innerHTML = '<div style="color:#888; padding:20px;">Chargement des photos...</div>';

    const photos = await window.catalogAPI.getPhotos(selectedFolderPath);
    currentPhotos = photos;
    
    if (stats) stats.textContent = `${photos.length} photo(s) affichée(s)`;

    grid.innerHTML = '';

    if (photos.length === 0) {
        grid.innerHTML = '<div style="color:#888; padding:20px;">Aucune photo dans ce dossier.</div>';
        return;
    }

    // Génération des cartes avec TOUTES les EXIF
    photos.forEach(photo => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cursor = 'pointer';
        
        // Construire les informations EXIF
        let exifInfo = '';
        if (photo.make || photo.model) {
            exifInfo += `${photo.make || ''} ${photo.model || ''}`;
        }
        if (photo.focal_length) {
            exifInfo += ` | ${photo.focal_length}mm`;
        }
        if (photo.aperture) {
            exifInfo += ` | f/${photo.aperture}`;
        }
        if (photo.iso) {
            exifInfo += ` | ISO ${photo.iso}`;
        }
        if (photo.shutter_speed) {
            exifInfo += ` | ${photo.shutter_speed}`;
        }
        
        card.innerHTML = `
            <div class="img-container">
                ${photo.thumbBase64 
                    ? `<img src="${photo.thumbBase64}" alt="${photo.file_name}">` 
                    : `<div style="color:#666;font-size:10px;text-align:center;padding:20px;">Pas de vignette</div>`
                }
                ${photo.rating ? `<div class="rating">⭐ ${photo.rating}</div>` : ''}
            </div>
            <div class="card-info">
                <div class="card-title" title="${photo.file_name}">${photo.file_name}</div>
                <div class="card-meta">${exifInfo || 'Aucune EXIF'}</div>
                ${photo.lens ? `<div class="card-lens" style="font-size:10px;color:#888;">🔭 ${photo.lens}</div>` : ''}
                ${photo.date_time_original ? `<div class="card-date" style="font-size:10px;color:#888;">📅 ${new Date(photo.date_time_original).toLocaleDateString()}</div>` : ''}
            </div>
        `;

        // CLIC SUR UNE PHOTO : Ouverture dans le Studio
        card.addEventListener('click', () => {
            if (photo.file_path && typeof window.loadImageInStudio === 'function') {
                window.loadImageInStudio(photo.file_path);
            }
        });

        grid.appendChild(card);
    });
}

// ============================================================
// FONCTION D'IMPORTATION
// ============================================================

async function handleSelectFolder() {
    const statusText = document.getElementById('statusText');
    if (!window.catalogAPI) return;

    if (statusText) statusText.textContent = "Sélection du dossier...";

    const res = await window.catalogAPI.selectFolder();
    if (res) {
        if (statusText) statusText.textContent = `Scan terminé : ${res.totalIndexed} photos.`;
        await refreshFolders();
        await refreshGrid();
    } else {
        if (statusText) statusText.textContent = "Importation annulée.";
    }
}

// ============================================================
// SUIVI DE PROGRESSION
// ============================================================

window.catalogAPI?.onScanProgress((data) => {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = `Indexation : ${data.current}/${data.total} (${data.filename})`;
    }
});

// ============================================================
// EXPOSER LA FONCTION POUR APP.JS
// ============================================================

/**
 * Fonction pour récupérer les EXIF d'une photo depuis la base
 * Utilisée par app.js
 */
async function getExifFromDatabase(filePath) {
    try {
        if (window.catalogAPI && typeof window.catalogAPI.getPhotoByPath === "function") {
            return await window.catalogAPI.getPhotoByPath(filePath);
        }
        return null;
    } catch (err) {
        console.error("❌ Erreur getExifFromDatabase:", err);
        return null;
    }
}

// Exposer globalement pour app.js
window.getExifFromDatabase = getExifFromDatabase;

// ============================================================
// INITIALISATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    refreshFolders();
    refreshGrid();

    // Écouteur sur le bouton Importer
    const btnSelect = document.getElementById('btnSelectFolder') || document.getElementById('btnImportFolder');
    if (btnSelect) {
        btnSelect.addEventListener('click', handleSelectFolder);
    }

    // Écouteur sur le bouton Retour au Studio
    const btnReturn = document.getElementById('btnReturnToStudioFromCatalog');
    if (btnReturn) {
        btnReturn.addEventListener('click', () => {
            if (typeof window.switchToView === 'function') {
                window.switchToView('view-studio');
            }
        });
    }
});

console.log("✅ catalogRenderer.js chargé - API catalogue avec EXIF disponible");