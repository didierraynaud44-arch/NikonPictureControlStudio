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
const { decodeRAWImage, SUPPORTED_EXTENSIONS, shutdownExiftool } = require("./services/rawDecoder");

// Import du Catalogue Photos & SQLite
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
        },
        {
            label: "Studio",
            click: () => {
                if (mainWindow) mainWindow.webContents.send("menu-switch-view", "view-studio");
            }
        },
        {
            label: "Gestionnaire de Profils",
            click: () => {
                if (mainWindow) mainWindow.webContents.send("menu-switch-view", "view-profiles");
            }
        },
        {
            label: "Exporter",
            submenu: [
                {
                    label: "Exporter l'image active...",
                    accelerator: "CmdOrCtrl+E",
                    click: () => {
                        if (mainWindow) mainWindow.webContents.send("menu-trigger-export");
                    }
                }
            ]
        }
    ]);

    Menu.setApplicationMenu(menu);
}

/* =======================================================
    5. Handlers IPC : Ouverture des fichiers & Arborescence
======================================================= */

const ALL_IMAGE_EXTENSIONS = [
    "nef", "cr2", "cr3", "raf", "arw", "rw2", "dng", "pef", "orf",
    "jpg", "jpeg", "png", "webp", "tif", "tiff"
];

// Scanner récursif de répertoire
function scanDirectoryRecursive(dirPath) {
    const name = path.basename(dirPath);
    const item = { name, path: dirPath, children: [], files: [] };

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    item.children.push(scanDirectoryRecursive(fullPath));
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase().replace('.', '');
                if (ALL_IMAGE_EXTENSIONS.includes(ext)) {
                    item.files.push({ name: entry.name, path: fullPath });
                }
            }
        }
    } catch (err) {
        console.error("❌ Erreur de lecture récursive du dossier :", dirPath, err);
    }

    return item;
}

// Sélectionner un dossier via boîte de dialogue
ipcMain.handle("select-folder-recursive", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Sélectionner un répertoire de photos",
        properties: ["openDirectory"]
    });

    if (result.canceled || !result.filePaths.length) return null;

    return scanDirectoryRecursive(result.filePaths[0]);
});

// Recharger un dossier sauvegardé sans boîte de dialogue
ipcMain.handle("read-folder-recursive", async (event, folderPath) => {
    if (!folderPath || !fs.existsSync(folderPath)) return null;
    return scanDirectoryRecursive(folderPath);
});

// Sélectionner le dossier de destination pour l'exportation
ipcMain.handle("dialog:selectExportFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Sélectionner le dossier de destination",
        properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
});

// Ouverture d'un fichier Image ou RAW (Filtrage Tolérant Majuscules/Minuscules)

// Ouverture d'un fichier Image ou RAW
ipcMain.handle("open-nef", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Sélectionner une photo / fichier RAW",
        properties: ["openFile"], // 👈 Forcer l'ouverture de FICHIER uniquement
        filters: [
            {
                name: "Fichiers Images & RAW",
                extensions: [
                    "nef", "NEF", 
                    "cr2", "CR2", "cr3", "CR3", 
                    "raf", "RAF", "arw", "ARW", 
                    "rw2", "RW2", "dng", "DNG", 
                    "pef", "PEF", "orf", "ORF", 
                    "jpg", "JPG", "jpeg", "JPEG", 
                    "png", "PNG", "webp", "WEBP", 
                    "tif", "TIF", "tiff", "TIFF"
                ]
            },
            {
                name: "Tous les fichiers (*.*)",
                extensions: ["*"]
            }
        ]
    });

    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();

    try {
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
// Décodage direct RAW
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

// Chargement d'un fichier NP3 / NCP
ipcMain.handle("loadNP3", async () => {
    const result = await dialog.showOpenDialog({
        title: "Charger un Picture Control",
        properties: ["openFile"],
        filters: [
            {
                name: "Picture Control Nikon",
                extensions: ["np3", "ncp", "NP3", "NCP"]
            },
            {
                name: "Tous les fichiers (*.*)",
                extensions: ["*"]
            }
        ]
    });

    if (result.canceled || !result.filePaths.length) return null;

    try {
        const pc = await loadNP3(result.filePaths[0]);
        pictureControlEngine.load(pc);
        return pictureControlEngine.get();
    } catch (err) {
        console.error("❌ Erreur chargement NP3/NCP :", err);
        throw err;
    }
});

// Lecture directe d'un fichier sans boîte de dialogue
ipcMain.handle("read-file-direct", async (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return null;

    const ext = path.extname(filePath).toLowerCase();

    try {
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
    7. Handlers IPC : Exportation & Sauvegarde (NP3, NCP, JPEG)
======================================================= */

ipcMain.handle("dialog:saveNP3", async (event, pcData) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Enregistrer le Picture Control",
        defaultPath: "CustomPictureControl.NP3",
        filters: [{ name: "Nikon Picture Control", extensions: ["NP3", "np3"] }]
    });

    if (canceled || !filePath) return false;

    try {
        const buffer = await saveNP3(pcData); 
        if (!buffer || buffer.length === 0) {
            throw new Error("L'encodage NP3 a produit un buffer vide.");
        }

        fs.writeFileSync(filePath, buffer);
        return true;
    } catch (err) {
        console.error("❌ Erreur lors de l'enregistrement du NP3 :", err);
        return false;
    }
});

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
        return true;
    } catch (err) {
        console.error("❌ Erreur écriture image :", err);
        return false;
    }
});

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

        return { success: true, path: filePath };
    } catch (err) {
        console.error("❌ Erreur d'export NCP :", err);
        throw err;
    }
});

/* =======================================================
    8. Handlers IPC : Catalogue Photos
======================================================= */

ipcMain.handle("catalog:select-folder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "Sélectionner un dossier de photos",
        properties: ["openDirectory"]
    });

    if (canceled || !filePaths.length) return null;

    const folderPath = filePaths[0];
    const cacheDir = path.join(app.getPath("userData"), "thumbnails");

    const totalIndexed = await scanFolder(folderPath, cacheDir, (current, total, filename) => {
        if (mainWindow) {
            mainWindow.webContents.send("catalog:scan-progress", { current, total, filename });
        }
    });

    return { folderPath, totalIndexed };
});

ipcMain.handle("catalog:get-folders", async () => {
    try {
        return await dbAll("SELECT * FROM folders ORDER BY folder_name ASC");
    } catch (err) {
        console.error("❌ Erreur récupération dossiers catalogue :", err);
        return [];
    }
});

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

// Performance GPU
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("force_high_performance_gpu");

/* =======================================================
    9. Cycle de vie de l'application Electron
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
    await shutdownExiftool();
});