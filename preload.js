const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // 1. Ouverture de fichiers et explorateur récursif
    openNEF: () => ipcRenderer.invoke("open-nef"),
    readFileDirect: (filePath) => ipcRenderer.invoke("read-file-direct", filePath),
    loadNP3: () => ipcRenderer.invoke("loadNP3"),
    selectFolderRecursive: () => ipcRenderer.invoke("select-folder-recursive"),
    readFolderRecursive: (folderPath) => ipcRenderer.invoke("read-folder-recursive", folderPath),
    selectExportFolder: () => ipcRenderer.invoke("dialog:selectExportFolder"),

    // 2. Gestion du Picture Control Engine
    updatePC: (key, value) => ipcRenderer.invoke("pc-update", key, value),
    getPC: () => ipcRenderer.invoke("pc-get"),
    pcReset: () => ipcRenderer.invoke("pc-reset"),

    // 3. Sauvegardes et Exports
    saveNP3File: (data) => ipcRenderer.invoke("dialog:saveNP3", data),
    exportNCP: (pcData) => ipcRenderer.invoke("export-ncp", pcData),
    saveJPEGFile: (data) => ipcRenderer.invoke("dialog:saveJPEG", data),
    saveImageFile: (data) => ipcRenderer.invoke("dialog:saveJPEG", data),

    // 4. Écouteurs de menu
    onMenuOpenNEF: (callback) => ipcRenderer.on("menu-open-nef", callback),
    onMenuOpenNP3: (callback) => ipcRenderer.on("menu-open-np3", callback),
    onMenuSwitchView: (callback) => ipcRenderer.on("menu-switch-view", (event, viewId) => callback(viewId)),
    onMenuTriggerExport: (callback) => ipcRenderer.on("menu-trigger-export", callback)
});

// --- Catalogue Photos ---
contextBridge.exposeInMainWorld("catalogAPI", {
    selectFolder: () => ipcRenderer.invoke("catalog:select-folder"),
    getFolders: () => ipcRenderer.invoke("catalog:get-folders"),
    getPhotos: (folderPath) => ipcRenderer.invoke("catalog:get-photos", folderPath),
    onScanProgress: (callback) => ipcRenderer.on("catalog:scan-progress", (event, data) => callback(data))
});