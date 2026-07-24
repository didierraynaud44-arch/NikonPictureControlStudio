const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
    "electronAPI",
    {

        openNEF: () =>
            ipcRenderer.invoke("open-nef"),

        loadNP3: () =>
            ipcRenderer.invoke("loadNP3"),

        getPC: () =>
            ipcRenderer.invoke("pc-get"),

        updatePC: (property, value) =>
            ipcRenderer.invoke(
                "pc-update",
                property,
                value
            ),

        resetPC: () =>
            ipcRenderer.invoke("pc-reset")

    }
);