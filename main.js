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

// 🎯 FIX ICI : Ajout de saveNCP dans l'import
const { loadNP3, saveNP3, saveNCP } = require("./services/np3Manager");

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

// --- Chargement d'un fichier binaire NP3 / NCP ---
ipcMain.handle("loadNP3", async () => {
    const result = await dialog.showOpenDialog({
        title: "Charger un Picture Control",
        properties: ["openFile"],
        filters: [
            {
                name: "Picture Control Nikon",
                extensions: ["np3", "ncp", "NP3", "NCP"]
            }
        ]
    });

    if (result.canceled || !result.filePaths.length) return null;

    try {
        // 🎯 Utilisation explicite du manager pour éviter le conflit de nom
        const np3Manager = require("./services/np3Manager");
        const pc = await np3Manager.loadNP3(result.filePaths[0]);

        pictureControlEngine.load(pc);
        return pictureControlEngine.get();
    } catch (err) {
        console.error("❌ Erreur chargement NP3/NCP :", err);
        throw err;
    }
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

// --- Exportation du rendu au format Image HD ---
ipcMain.handle("dialog:saveJPEG", async (event, data) => {
    const win = BrowserWindow.getFocusedWindow();

    let defaultName = "export";
    let base64Data = "";

    if (typeof data === "object" && data !== null) {
        defaultName = data.defaultName || "export";
        base64Data = data.base64Data || "";
    } else if (typeof data === "string") {
        base64Data = data;
    }

    const { filePath, canceled } = await dialog.showSaveDialog(win, {
        title: "Exporter la photo",
        defaultPath: `${defaultName}.jpg`,
        filters: [
            { name: "Image JPEG (*.jpg)", extensions: ["jpg", "jpeg"] },
            { name: "Image PNG (*.png)", extensions: ["png"] },
            { name: "Image WebP (*.webp)", extensions: ["webp"] },
            { name: "Image TIFF (*.tif)", extensions: ["tif", "tiff"] }
        ]
    });

    if (canceled || !filePath) return false;

    try {
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(cleanBase64, "base64");

        fs.writeFileSync(filePath, imageBuffer);
        console.log("✅ Photo exportée avec succès sous :", filePath);

        return true;
    } catch (err) {
        console.error("❌ Erreur écriture image :", err);
        return false;
    }
});

// --- Exportation du fichier NCP (Nikon Z6 II) ---
ipcMain.handle("export-ncp", async (event, pcData) => {
    try {
        const { filePath, canceled } = await dialog.showSaveDialog({
            title: "Exporter pour Nikon Z6 II (.NCP)",
            defaultPath: "NC_Z6II01.NCP",
            filters: [{ name: "Nikon Picture Control 2.0", extensions: ["NCP", "ncp"] }]
        });

        if (canceled || !filePath) return { success: false };

        // 🎯 saveNCP est maintenant bien disponible via l'import
        const buffer = await saveNCP(pcData);
        
        fs.writeFileSync(filePath, buffer);
        console.log("✅ Fichier NCP (Z6 II) sauvegardé sous :", filePath);

        return { success: true, path: filePath };
    } catch (err) {
        console.error("❌ Erreur d'export NCP :", err);
        throw err;
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