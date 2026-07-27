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
    saveJPEGFile: (base64Data) => ipcRenderer.invoke("dialog:saveJPEG", base64Data),

    // 4. Écouteurs de menu (Facultatif)
    onMenuOpenNEF: (callback) => ipcRenderer.on("menu-open-nef", callback),
    onMenuOpenNP3: (callback) => ipcRenderer.on("menu-open-np3", callback)
});