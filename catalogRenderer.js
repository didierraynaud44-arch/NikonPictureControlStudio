/*=========================================================
    Nikon Picture Control Studio - Catalog Renderer
=========================================================*/

let selectedFolderPath = null;

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

async function refreshGrid() {
    const grid = document.getElementById('grid');
    const stats = document.getElementById('stats') || document.getElementById('catalog-stats');
    if (!grid || !window.catalogAPI) return;

    grid.innerHTML = '<div style="color:#888; padding:20px;">Chargement des photos...</div>';

    const photos = await window.catalogAPI.getPhotos(selectedFolderPath);
    if (stats) stats.textContent = `${photos.length} photo(s) affichée(s)`;

    grid.innerHTML = '';

    if (photos.length === 0) {
        grid.innerHTML = '<div style="color:#888; padding:20px;">Aucune photo dans ce dossier.</div>';
        return;
    }

    // Génération des cartes avec événement de clic vers le Studio
    photos.forEach(photo => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="img-container">
                ${photo.thumbBase64 
                    ? `<img src="${photo.thumbBase64}" alt="${photo.file_name}">` 
                    : `<div style="color:#666;font-size:10px;text-align:center;padding:20px;">Pas de vignette</div>`
                }
            </div>
            <div class="card-info">
                <div class="card-title" title="${photo.file_name}">${photo.file_name}</div>
                <div class="card-meta">ISO ${photo.iso || '?'} | f/${photo.aperture || '?'}</div>
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

// Fonction globale d'importation de dossier
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

// Suivi de progression en temps réel
window.catalogAPI?.onScanProgress((data) => {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = `Indexation : ${data.current}/${data.total} (${data.filename})`;
    }
});

// Événements d'initialisation et de navigation
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