const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    openNEF: () => ipcRenderer.invoke("open-nef"),
    loadNP3: () => ipcRenderer.invoke("loadNP3"),
    pcGet: () => ipcRenderer.invoke("pc-get"),
    updatePC: (property, value) => ipcRenderer.invoke("pc-update", property, value),
    
    // 👇 C'est cette ligne exacte qui manquait et causait l'erreur !
    pcReset: () => ipcRenderer.invoke("pc-reset")
});