/* =======================================================
   1. Imports des modules Node & Electron
======================================================= */
const {
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    dialog
} = require("electron");

const path = require("path");
const fs = require("fs");
const os = require("os");

/* =======================================================
   2. Imports des moteurs applicatifs & services
======================================================= */
const pictureControlEngine = require("./services/pictureControlEngine");
const { readNEF } = require("./engine/nefReader");
const { getPreview } = require("./engine/nefPreview");
const { readPictureControl } = require("./engine/pictureControl");

// Importation de loadNP3 ET saveNP3 depuis le manager
const { loadNP3, saveNP3 } = require("./services/np3Manager");

let mainWindow = null;

/* =======================================================
   3. Création de la fenêtre principale
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
   4. Menu supérieur de l'application
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
   5. Handlers IPC : Ouverture des fichiers (NEF & NP3)
======================================================= */

// --- Ouverture d'un fichier NEF ---
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

    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];

    // Lecture des métadonnées EXIF et de la prévisualisation JPEG
    const info = await readNEF(filePath);
    info.preview = await getPreview(filePath);

    // Lecture du Picture Control embarqué dans le fichier NEF
    const pictureControl = await readPictureControl(filePath);
    pictureControlEngine.load(pictureControl);
    info.pictureControl = pictureControlEngine.get();

    return info;
});

// --- Chargement d'un fichier binaire NP3 ---
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

    if (result.canceled || !result.filePaths.length) return null;

    const pc = await loadNP3(result.filePaths[0]);
    pictureControlEngine.load(pc);

    return pictureControlEngine.get();
});

/* =======================================================
   6. Handlers IPC : Moteur Picture Control Engine
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
   7. Handlers IPC : Exportation & Sauvegarde (NP3 & JPEG)
======================================================= */

// --- Sauvegarde du fichier NP3 binaire ---
ipcMain.handle("dialog:saveNP3", async (event, pcData) => {
    console.log("🚀 Lancement de l'enregistrement NP3...");

    const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Enregistrer le Picture Control",
        defaultPath: "CustomPictureControl.NP3",
        filters: [{ name: "Nikon Picture Control", extensions: ["NP3", "np3"] }]
    });

    if (canceled || !filePath) {
        console.log("🛑 Sauvegarde annulée.");
        return false;
    }

    try {
        console.log("📝 Données à encoder :", pcData);

        // Encodage binaire via la fonction saveNP3 de np3Manager
        const buffer = await saveNP3(pcData); 

        if (!buffer || buffer.length === 0) {
            throw new Error("L'encodage NP3 a produit un buffer vide.");
        }

        // Écriture du fichier binaire sur le disque
        fs.writeFileSync(filePath, buffer);
        console.log("✅ Fichier NP3 binaire sauvegardé avec succès sous :", filePath);

        return true;
    } catch (err) {
        console.error("❌ Erreur lors de l'enregistrement du NP3 :", err);
        return false;
    }
});

// --- Exportation du rendu au format Image JPEG HD ---
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
        console.log("✅ Image JPEG exportée avec succès sous :", filePath);

        return true;
    } catch (err) {
        console.error("❌ Erreur écriture JPEG :", err);
        return false;
    }
});

/* =======================================================
   8. Cycle de vie de l'application Electron
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