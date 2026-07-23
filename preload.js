const { contextBridge, ipcRenderer } = require("electron");


contextBridge.exposeInMainWorld(
    "electronAPI",
    {

        openNEF: () => ipcRenderer.invoke("open-nef")

    }
);