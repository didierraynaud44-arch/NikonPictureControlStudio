const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {

    // ============================================================
    // PERSISTANCE DES RÉGLAGES PICTURE CONTROL
    // ============================================================
    
    // 🔥 CORRECTION : Utiliser catalog:save-settings au lieu de catalog:save-photo-pc
    savePhotoSettings: (filePath, pcData) => 
        ipcRenderer.invoke("catalog:save-settings", filePath, pcData),
    
    // 🔥 AJOUT : Méthode pour charger les réglages
    getPhotoSettings: (filePath) => 
        ipcRenderer.invoke("get-photo-settings", filePath),
    
    // 🔥 AJOUT : Méthode générique invoke pour les appels dynamiques
    invoke: (channel, ...args) => 
        ipcRenderer.invoke(channel, ...args),

    // ============================================================
    // IMPRESSION
    // ============================================================
    
    loadImageForPrint: (imagePath, pictureControl) => 
        ipcRenderer.invoke("load-image-for-print", imagePath, pictureControl),
    
    printOrSavePdf: (data) => 
        ipcRenderer.invoke("print-or-save-pdf", data),
    
    loadICC: () =>
        ipcRenderer.invoke("loadICC"),

    // ============================================================
    // CATALOGUE SQLITE
    // ============================================================
    
    addCatalogFolder: (folderData) => 
        ipcRenderer.invoke("catalog:add-folder", folderData),
    
    getCatalog: () => 
        ipcRenderer.invoke("catalog:get-all"),
    
    removeCatalogFolder: (folderPath) =>
        ipcRenderer.invoke("catalog:remove-folder", folderPath),

    getCatalogStats: () =>
        ipcRenderer.invoke("catalog:get-stats"),

    // ============================================================
    // LIENS EXTERNES (navigateur système)
    // ============================================================

    openExternalLink: (url) =>
        ipcRenderer.invoke("open-external-link", url),

    // Garder l'ancien nom pour compatibilité (mais utiliser le nouveau handler)
    // savePhotoSettings: (filePath, pcData) => 
    //     ipcRenderer.invoke("catalog:save-photo-pc", filePath, pcData),

    // ============================================================
    // OUVERTURE DE FICHIERS ET EXPLORATEUR RÉCURSIF
    // ============================================================
    
    openNEF: () => 
        ipcRenderer.invoke("open-nef"),
    
    readFileDirect: (filePath, maxWidth) =>
        ipcRenderer.invoke("read-file-direct", filePath, maxWidth),

    getFullResolutionImage: (filePath) =>
        ipcRenderer.invoke("get-full-resolution-image", filePath),

    getPreviewQuality: () =>
        ipcRenderer.invoke("get-preview-quality"),

    setPreviewQuality: (maxWidth) =>
        ipcRenderer.invoke("set-preview-quality", maxWidth),

    getThumbnail: (filePath) =>
        ipcRenderer.invoke("get-thumbnail", filePath),

    getShutterCount: (filePath) =>
        ipcRenderer.invoke("get-shutter-count", filePath),

    loadNP3: (formatFilter) =>
        ipcRenderer.invoke("loadNP3", formatFilter),
    
    selectFolderRecursive: () => 
        ipcRenderer.invoke("select-folder-recursive"),
    
    readFolderRecursive: (folderPath) => 
        ipcRenderer.invoke("read-folder-recursive", folderPath),
    
    selectExportFolder: () =>
        ipcRenderer.invoke("dialog:selectExportFolder"),

    toggleFullscreen: () =>
        ipcRenderer.invoke("toggle-fullscreen"),

    // ============================================================
    // SAUVEGARDE / RESTAURATION DU CATALOGUE
    // ============================================================

    exportBackup: () =>
        ipcRenderer.invoke("catalog:export-backup"),

    importBackup: () =>
        ipcRenderer.invoke("catalog:import-backup"),

    onCatalogRestored: (callback) =>
        ipcRenderer.on("catalog:restored", callback),

    // ============================================================
    // NOTATION & STATUT DES PHOTOS
    // ============================================================

    setPhotoRating: (filePath, rating) =>
        ipcRenderer.invoke("set-photo-rating", filePath, rating),

    setPhotoFlag: (filePath, flag) =>
        ipcRenderer.invoke("set-photo-flag", filePath, flag),

    getPhotosStatus: (filePaths) =>
        ipcRenderer.invoke("get-photos-status", filePaths),

    // ============================================================
    // PICTURE CONTROL ENGINE
    // ============================================================
    
    updatePC: (key, value) => 
        ipcRenderer.invoke("pc-update", key, value),
    
    getPC: () => 
        ipcRenderer.invoke("pc-get"),
    
    pcReset: () => 
        ipcRenderer.invoke("pc-reset"),

    // ============================================================
    // SAUVEGARDES ET EXPORTS
    // ============================================================
    
    saveNP3File: (data) => 
        ipcRenderer.invoke("dialog:saveNP3", data),
    
    exportNCP: (pcData) => 
        ipcRenderer.invoke("export-ncp", pcData),
    
    saveJPEGFile: (data) => 
        ipcRenderer.invoke("dialog:saveJPEG", data),
    
    saveImageFile: (data) => 
        ipcRenderer.invoke("dialog:saveJPEG", data),

    // ============================================================
    // ÉCOUTEURS DE MENU
    // ============================================================
    
    onMenuOpenNEF: (callback) =>
        ipcRenderer.on("menu-open-nef", callback),

    onMenuOpenSettings: (callback) =>
        ipcRenderer.on("menu-open-settings", (event, tab) => callback(tab)),

    onMenuSwitchView: (callback) =>
        ipcRenderer.on("menu-switch-view", (event, viewId) => callback(viewId)),

    onMenuSetPreviewQuality: (callback) =>
        ipcRenderer.on("menu-set-preview-quality", (event, maxWidth) => callback(maxWidth)),
    
    onMenuTriggerExport: (callback) =>
        ipcRenderer.on("menu-trigger-export", callback),

    onMenuExportBackup: (callback) =>
        ipcRenderer.on("menu-export-backup", callback),

    onMenuImportBackup: (callback) =>
        ipcRenderer.on("menu-import-backup", callback),

    onMenuOpenExternalProgramsConfig: (callback) =>
        ipcRenderer.on("menu-open-external-programs-config", callback),

    // ============================================================
    // PROGRAMMES EXTERNES ("Ouvrir avec...")
    // ============================================================

    getExternalPrograms: () =>
        ipcRenderer.invoke("get-external-programs"),

    saveExternalPrograms: (programs) =>
        ipcRenderer.invoke("save-external-programs", programs),

    getFrameSettings: () =>
        ipcRenderer.invoke("get-frame-settings"),

    saveFrameSettings: (settings) =>
        ipcRenderer.invoke("save-frame-settings", settings),

    // ============================================================
    // ESPACE COLORIMÉTRIQUE PAR DÉFAUT (export/impression, voir Partie 4)
    // ============================================================

    getDefaultColorSpace: () =>
        ipcRenderer.invoke("get-default-color-space"),

    saveDefaultColorSpace: (value) =>
        ipcRenderer.invoke("save-default-color-space", value),

    checkIccProfiles: () =>
        ipcRenderer.invoke("check-icc-profiles"),

    browseExecutable: () =>
        ipcRenderer.invoke("browse-executable"),

    openInExternalProgram: (payload) =>
        ipcRenderer.invoke("open-in-external-program", payload),

    // ============================================================
    // SIMULATION PELLICULE (Hald-CLUT)
    // ============================================================

    browseHaldClut: () =>
        ipcRenderer.invoke("browse-hald-clut"),

    listHaldClutPresets: () =>
        ipcRenderer.invoke("list-hald-clut-presets"),

    // ============================================================
    // CORRECTION D'OBJECTIF (base Lensfun + profils importés)
    // ============================================================

    listLensDatabaseFiles: () =>
        ipcRenderer.invoke("list-lens-database-files"),

    listImportedLensProfiles: () =>
        ipcRenderer.invoke("list-imported-lens-profiles"),

    importLensProfile: () =>
        ipcRenderer.invoke("import-lens-profile"),

    addSingleFileToCatalog: (filePath) =>
        ipcRenderer.invoke("catalog:add-single-file", filePath),

    // ============================================================
    // NETTOYAGE DES ÉCOUTEURS (optionnel mais recommandé)
    // ============================================================
    
    removeAllListeners: (channel) => 
        ipcRenderer.removeAllListeners(channel),
});

// ============================================================
// CATALOGUE PHOTOS (API séparée)
// ============================================================

contextBridge.exposeInMainWorld("catalogAPI", {
    selectFolder: () => 
        ipcRenderer.invoke("catalog:select-folder"),
    
    getFolders: () => 
        ipcRenderer.invoke("catalog:get-folders"),
    
    getPhotos: (folderPath) => 
        ipcRenderer.invoke("catalog:get-photos", folderPath),
    
    onScanProgress: (callback) => 
        ipcRenderer.on("catalog:scan-progress", (event, data) => callback(data))
});