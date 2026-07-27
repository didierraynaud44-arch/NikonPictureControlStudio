const {
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    dialog
} = require("electron");

const path = require("path");
const fs = require("fs");

const pictureControlEngine = require("./services/pictureControlEngine");
const { readNEF } = require("./engine/nefReader");
const { getPreview } = require("./engine/nefPreview");
const { readPictureControl } = require("./engine/pictureControl");
const { loadNP3 } = require("./services/np3Manager");

let mainWindow = null;

/* =======================================================
   Fenêtre principale
======================================================= */

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 950,
        minWidth: 1200,
        minHeight: 800,
        title: "Nikon Picture Control Studio",
        backgroundColor: "#202124",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile("renderer/index.html");
    mainWindow.webContents.openDevTools();
}

/* =======================================================
   Menu
======================================================= */

function createAppMenu() {
    const menu = Menu.buildFromTemplate([
        {
            label: "Fichier",
            submenu: [
                {
                    label: "Ouvrir un NEF",
                    click: () => {
                        if (mainWindow) mainWindow.webContents.send("menu-open-nef");
                    }
                },
                {
                    label: "Charger un Picture Control (.NP3)",
                    click: () => {
                        if (mainWindow) mainWindow.webContents.send("menu-open-np3");
                    }
                },
                { type: "separator" },
                {
                    label: "Quitter",
                    click: () => app.quit()
                }
            ]
        }
    ]);

    Menu.setApplicationMenu(menu);
}

/* =======================================================
   Ouvrir un NEF
======================================================= */

ipcMain.handle("open-nef", async () => {
    const result = await dialog.showOpenDialog({
        title: "Choisir un fichier Nikon NEF",
        properties: ["openFile"],
        filters: [
            {
                name: "Nikon RAW",
                extensions: ["nef"]
            }
        ]
    });

    if (result.canceled) return null;

    const filePath = result.filePaths[0];
    const info = await readNEF(filePath);
    info.preview = await getPreview(filePath);

    const pictureControl = await readPictureControl(filePath);
    pictureControlEngine.load(pictureControl);
    info.pictureControl = pictureControlEngine.get();

    return info;
});

/* =======================================================
   Charger un NP3
======================================================= */

ipcMain.handle("loadNP3", async () => {
    const result = await dialog.showOpenDialog({
        title: "Charger un Picture Control",
        properties: ["openFile"],
        filters: [
            {
                name: "Picture Control Nikon",
                extensions: ["np3"]
            }
        ]
    });

    if (result.canceled) return null;

    const pc = await loadNP3(result.filePaths[0]);
    pictureControlEngine.load(pc);

    return pictureControlEngine.get();
});

/* =======================================================
   Picture Control Engine (IPC Handlers)
======================================================= */

ipcMain.handle("pc-get", () => {
    return pictureControlEngine.get();
});

ipcMain.handle("pc-update", (event, property, value) => {
    pictureControlEngine.update(property, value);
    return pictureControlEngine.get();
});

ipcMain.handle("pc-reset", () => {
    pictureControlEngine.reset();
    return pictureControlEngine.get();
});

/* =======================================================
   Sauvegardes (NP3 & JPEG)
======================================================= */

// --- Sauvegarde du fichier NP3 ---
ipcMain.handle("dialog:saveNP3", async (event, pcData) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Enregistrer le Picture Control",
        defaultPath: "CustomPictureControl.np3",
        filters: [{ name: "Nikon Picture Control", extensions: ["np3", "json"] }]
    });

    if (canceled || !filePath) return false;

    try {
        fs.writeFileSync(filePath, JSON.stringify(pcData, null, 2), "utf-8");
        return true;
    } catch (err) {
        console.error("Erreur écriture NP3 :", err);
        return false;
    }
});

// --- Exportation du fichier JPG HD ---
ipcMain.handle("dialog:saveJPEG", async (event, base64Data) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Exporter la photo en JPEG",
        defaultPath: "Export.jpg",
        filters: [{ name: "Image JPEG", extensions: ["jpg", "jpeg"] }]
    });

    if (canceled || !filePath) return false;

    try {
        const base64Image = base64Data.replace(/^data:image\/jpeg;base64,/, "");
        const imageBuffer = Buffer.from(base64Image, "base64");

        fs.writeFileSync(filePath, imageBuffer);
        return true;
    } catch (err) {
        console.error("Erreur écriture JPEG :", err);
        return false;
    }
});

/* =======================================================
   Cycle de vie Electron
======================================================= */

app.whenReady().then(() => {
    createMainWindow();
    createAppMenu();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});