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

// Import du décodeur RAW multi-marques (LibRaw)
const { decodeRAWImage, SUPPORTED_EXTENSIONS } = require("./services/rawDecoder");
// Manager Catalogue & SQLite
// Import du Catalogue Photos & SQLite (fichiers placés à la racine)
const { initDatabase, dbAll } = require("./db");
const { scanFolder } = require("./scanner");

// Import du manager NP3 / NCP
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
                    label: "Ouvrir une image / RAW",
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
   5. Handlers IPC : Ouverture des fichiers (NEF, RAW & NP3)
======================================================= */

// Liste complète des extensions acceptées dans la boîte de dialogue
const ALL_IMAGE_EXTENSIONS = [
    "nef", "cr2", "cr3", "raf", "arw", "rw2", "dng", "pef", "orf",
    "jpg", "jpeg", "png", "webp", "tif", "tiff"
];

// --- Ouverture d'un fichier Image ou RAW ---
ipcMain.handle("open-nef", async () => {
    const result = await dialog.showOpenDialog({
        title: "Choisir un fichier Image ou RAW",
        properties: ["openFile"],
        filters: [
            {
                name: "Tous les fichiers RAW & Images",
                extensions: ALL_IMAGE_EXTENSIONS
            },
            {
                name: "Fichiers RAW (Nikon, Canon, Fuji, Sony, Panasonic)",
                extensions: ["nef", "cr2", "cr3", "raf", "arw", "rw2", "dng", "pef", "orf"]
            },
            {
                name: "Images Standard",
                extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff"]
            }
        ]
    });

    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();

    try {
        // CAS 1 : Fichier NEF Nikon (Logique d'origine conservée pour les métadonnées et PC)
        if (ext === ".nef") {
            const info = await readNEF(filePath);
            info.preview = await getPreview(filePath);

            try {
                const pictureControl = await readPictureControl(filePath);
                pictureControlEngine.load(pictureControl);
                info.pictureControl = pictureControlEngine.get();
            } catch (pcErr) {
                console.warn("⚠️ Impossible de lire le Picture Control embarqué du NEF :", pcErr.message);
            }

            return info;
        }

        // CAS 2 : Autre format RAW (Canon, Fuji, Sony, Panasonic...)
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
            console.log(`📷 Décodage du fichier RAW multi-marques (${ext}) :`, filePath);
            const previewDataUrl = await decodeRAWImage(filePath);

            return {
                filePath: filePath,
                fileName: path.basename(filePath),
                preview: previewDataUrl,
                isRaw: true,
                pictureControl: pictureControlEngine.get()
            };
        }

        // CAS 3 : Image Standard (JPG, PNG, TIFF...)
        return {
            filePath: filePath,
            fileName: path.basename(filePath),
            preview: filePath,
            isStandardImage: true,
            pictureControl: pictureControlEngine.get()
        };

    } catch (err) {
        console.error("❌ Erreur lors de l'ouverture du fichier :", err);
        throw err;
    }
});

// --- Handler IPC dédié au décodage direct d'un RAW ---
ipcMain.handle("decode-raw", async (event, filePath) => {
    try {
        const ext = path.extname(filePath).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
            const imageDataUrl = await decodeRAWImage(filePath);
            return { success: true, data: imageDataUrl };
        }
        return { success: true, isStandardImage: true, path: filePath };
    } catch (error) {
        console.error("❌ Erreur handler decode-raw :", error);
        return { success: false, error: error.message };
    }
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
        const np3Manager = require("./services/np3Manager");
        const pc = await np3Manager.loadNP3(result.filePaths[0]);

        pictureControlEngine.load(pc);
        return pictureControlEngine.get();
    } catch (err) {
        console.error("❌ Erreur chargement NP3/NCP :", err);
        throw err;
    }
});
// --- Lecture directe d'un fichier (utilisé par le Catalogue sans ouvrir de boite de dialogue) ---
ipcMain.handle("read-file-direct", async (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return null;

    const ext = path.extname(filePath).toLowerCase();

    try {
        // CAS 1 : Fichier NEF Nikon
        if (ext === ".nef") {
            const info = await readNEF(filePath);
            info.preview = await getPreview(filePath);

            try {
                const pictureControl = await readPictureControl(filePath);
                pictureControlEngine.load(pictureControl);
                info.pictureControl = pictureControlEngine.get();
            } catch (pcErr) {
                console.warn("⚠️ Impossible de lire le Picture Control embarqué du NEF :", pcErr.message);
            }

            return info;
        }

        // CAS 2 : Autre format RAW (Canon, Sony, Fuji...)
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
            const previewDataUrl = await decodeRAWImage(filePath);
            return {
                filePath: filePath,
                fileName: path.basename(filePath),
                preview: previewDataUrl,
                isRaw: true,
                pictureControl: pictureControlEngine.get()
            };
        }

        // CAS 3 : Image Standard (JPG, PNG...)
        return {
            filePath: filePath,
            fileName: path.basename(filePath),
            preview: filePath,
            isStandardImage: true,
            pictureControl: pictureControlEngine.get()
        };

    } catch (err) {
        console.error("❌ Erreur lors de la lecture directe du fichier :", err);
        return null;
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

        const buffer = await saveNP3(pcData); 

        if (!buffer || buffer.length === 0) {
            throw new Error("L'encodage NP3 a produit un buffer vide.");
        }

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
   9. Handlers IPC : Catalogue Photos
======================================================= */

// 1. Sélection et scan d'un répertoire
ipcMain.handle("catalog:select-folder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "Sélectionner un dossier de photos",
        properties: ["openDirectory"]
    });

    if (canceled || !filePaths.length) return null;

    const folderPath = filePaths[0];
    const cacheDir = path.join(app.getPath("userData"), "thumbnails");

    // Lancement du scan avec envoi de la progression en temps réel au renderer
    const totalIndexed = await scanFolder(folderPath, cacheDir, (current, total, filename) => {
        if (mainWindow) {
            mainWindow.webContents.send("catalog:scan-progress", { current, total, filename });
        }
    });

    return { folderPath, totalIndexed };
});

// 2. Récupération de la liste des dossiers indexés
ipcMain.handle("catalog:get-folders", async () => {
    try {
        return await dbAll("SELECT * FROM folders ORDER BY folder_name ASC");
    } catch (err) {
        console.error("❌ Erreur récupération dossiers catalogue :", err);
        return [];
    }
});

// 3. Récupération des photos (avec conversion des vignettes en Base64 pour l'IHM)
ipcMain.handle("catalog:get-photos", async (event, folderPath) => {
    try {
        let query = "SELECT * FROM photos ORDER BY id DESC";
        let params = [];

        if (folderPath && folderPath !== "ALL") {
            query = "SELECT * FROM photos WHERE folder_path = ? ORDER BY id DESC";
            params = [folderPath];
        }

        const photos = await dbAll(query, params);
        const cacheDir = path.join(app.getPath("userData"), "thumbnails");

        // Attacher l'image de vignette encodée en base64 pour chaque photo
        return photos.map((photo) => {
            const thumbPath = path.join(cacheDir, `${path.parse(photo.file_name).name}_thumb.jpg`);
            let thumbBase64 = null;

            if (fs.existsSync(thumbPath)) {
                const buffer = fs.readFileSync(thumbPath);
                thumbBase64 = `data:image/jpeg;base64,${buffer.toString("base64")}`;
            }

            return {
                ...photo,
                thumbBase64: thumbBase64
            };
        });
    } catch (err) {
        console.error("❌ Erreur récupération photos catalogue :", err);
        return [];
    }
});
/* =======================================================
   8. Cycle de vie de l'application Electron
======================================================= */

app.whenReady().then(() => {
    const dbPath = path.join(app.getPath("userData"), "catalog.db");
    initDatabase(dbPath);
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
app.on('will-quit', async () => {
    const { shutdownExiftool } = require('./services/rawDecoder');
    await shutdownExiftool();
});
app.on('will-quit', async () => {
    const { shutdownExiftool } = require('./services/rawDecoder');
    await shutdownExiftool();
});