const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // 1. Ouverture de fichiers
    openNEF: () => ipcRenderer.invoke("open-nef"),
    loadNP3: () => ipcRenderer.invoke("loadNP3"),

    // 2. Gestion du Picture Control Engine
    updatePC: (key, value) => ipcRenderer.invoke("pc-update", key, value),
    getPC: () => ipcRenderer.invoke("pc-get"),
    pcReset: () => ipcRenderer.invoke("pc-reset"),

    // 3. Sauvegardes et Exports
    saveNP3File: (data) => ipcRenderer.invoke("dialog:saveNP3", data),
	exportNCP: (pcData) => ipcRenderer.invoke("export-ncp", pcData),
    
    // 🎯 MISE À JOUR : On accepte l'objet complet { defaultName, base64Data } ou juste le base64
    saveJPEGFile: (data) => ipcRenderer.invoke("dialog:saveJPEG", data),
    saveImageFile: (data) => ipcRenderer.invoke("dialog:saveJPEG", data),

    // 4. Écouteurs de menu (Facultatif)
    onMenuOpenNEF: (callback) => ipcRenderer.on("menu-open-nef", callback),
    onMenuOpenNP3: (callback) => ipcRenderer.on("menu-open-np3", callback)
});