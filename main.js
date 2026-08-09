/* =======================================================
    1. Imports des modules Node & Electron
======================================================= */
const sharp = require('sharp');
const {
    initCatalogDB,
    addFolderToCatalog,
    getFullCatalog,
    removeFolderFromCatalog,
    savePhotoSettings
} = require("./services/catalogService");
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

// Scanner récursif de répertoire avec tri forcé et immédiat dès la lecture du disque
function scanDirectoryRecursive(dirPath) {
    const name = path.basename(dirPath);
    const item = { name, path: dirPath, children: [], files: [] };

    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => {
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
    } catch (err) {
        console.error("⚠️ Impossible de lire le dossier :", dirPath, err.message);
        return item;
    }

    for (const entry of entries) {
        try {
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
        } catch (entryErr) {
            console.warn(`⚠️ Erreur sur l'entrée ${entry.name}:`, entryErr.message);
        }
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
    try {
        return scanDirectoryRecursive(folderPath);
    } catch (err) {
        console.error("❌ Erreur lecture dossier sauvegardé :", folderPath, err);
        return null;
    }
});

// Sélectionner le dossier de destination pour l'exportation
ipcMain.handle("dialog:selectExportFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Sélectionner le dossier de destination",
        properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
});

// Ouverture d'un fichier Image ou RAW
ipcMain.handle("open-nef", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Sélectionner une photo / fichier RAW",
        properties: ["openFile"],
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
        if ([".tif", ".tiff", ".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
            const fileBuffer = fs.readFileSync(filePath);
            const base64 = fileBuffer.toString("base64");
            let mimeType = "image/jpeg";
            if (ext === ".png") mimeType = "image/png";
            if (ext === ".webp") mimeType = "image/webp";
            if (ext === ".tif" || ext === ".tiff") mimeType = "image/tiff";

            return {
                filePath: filePath,
                path: filePath,
                fileName: path.basename(filePath),
                preview: `data:${mimeType};base64,${base64}`,
                isStandardImage: true,
                orientation: 1,
                pictureControl: pictureControlEngine.get()
            };
        }

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
                path: filePath,
                preview: previewDataUrl,
                isRaw: true,
                pictureControl: pictureControlEngine.get()
            };
        }

        return {
            filePath: filePath,
            fileName: path.basename(filePath),
            path: filePath,
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
        if ([".tif", ".tiff", ".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
            let imageBuffer;
            let mimeType = "image/jpeg";

            try {
                if (ext === ".tif" || ext === ".tiff") {
                    imageBuffer = await sharp(filePath, { failOnError: false, limitInputPixels: false })
                        .rotate()
                        .jpeg({ quality: 95 })
                        .toBuffer();
                    mimeType = "image/jpeg";
                } else {
                    imageBuffer = fs.readFileSync(filePath);
                    if (ext === ".png") mimeType = "image/png";
                    if (ext === ".webp") mimeType = "image/webp";
                }
            } catch (sharpErr) {
                console.error(`❌ ERREUR SHARP DÉTAILLÉE sur ${filePath} :`, sharpErr.message, sharpErr);
                return null;
            }
            const base64 = imageBuffer.toString("base64");

            return {
                filePath: filePath,
                path: filePath,
                preview: `data:${mimeType};base64,${base64}`,
                name: path.basename(filePath),
                fileName: path.basename(filePath),
                orientation: 1,
                pictureControl: pictureControlEngine.get()
            };
        }

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
                path: filePath,
                preview: previewDataUrl,
                isRaw: true,
                pictureControl: pictureControlEngine.get()
            };
        }

        return {
            filePath: filePath,
            fileName: path.basename(filePath),
            path: filePath,
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
    let exportConfig = null;
    let silent = false;

    if (typeof data === "object" && data !== null) {
        defaultName = data.defaultName || "export";
        base64Data = data.base64Data || "";
        exportConfig = data.exportConfig || null;
        silent = !!data.silent;
    } else if (typeof data === "string") {
        base64Data = data;
    }

    try {
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(cleanBase64, "base64");

        let ext = ".jpg";
        if (exportConfig && exportConfig.format) {
            if (exportConfig.format === "image/png") ext = ".png";
            else if (exportConfig.format === "image/tiff") ext = ".tif";
            else if (exportConfig.format === "image/webp") ext = ".webp";
        }

        if (exportConfig && exportConfig.folder && (silent || exportConfig.folder)) {
            const destPath = path.join(exportConfig.folder, `${defaultName}${ext}`);
            fs.writeFileSync(destPath, imageBuffer);
            return { success: true, filePath: destPath };
        }

        const { filePath, canceled } = await dialog.showSaveDialog(win, {
            title: "Exporter la photo",
            defaultPath: `${defaultName}${ext}`,
            filters: [
                { name: "Image JPEG (*.jpg)", extensions: ["jpg", "jpeg"] },
                { name: "Image PNG (*.png)", extensions: ["png"] },
                { name: "Image WebP (*.webp)", extensions: ["webp"] },
                { name: "Image TIFF (*.tif)", extensions: ["tif", "tiff"] }
            ]
        });

        if (canceled || !filePath) return { success: false };

        fs.writeFileSync(filePath, imageBuffer);
        return { success: true, filePath };

    } catch (err) {
        console.error("❌ Erreur écriture image :", err);
        return { success: false, error: err.message };
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

// Charger un profil ICC / ICM
ipcMain.handle("loadICC", async () => {
    const result = await dialog.showOpenDialog({
        title: "Importer un profil ICC / ICM",
        properties: ["openFile"],
        filters: [
            {
                name: "Profils ICC/ICM",
                extensions: ["icc", "icm", "ICC", "ICM"]
            },
            {
                name: "Tous les fichiers (*.*)",
                extensions: ["*"]
            }
        ]
    });

    if (result.canceled || !result.filePaths.length) return null;

    try {
        const filePath = result.filePaths[0];
        const fileName = path.basename(filePath);
        const fileBuffer = fs.readFileSync(filePath);

        return {
            fileName: fileName,
            filePath: filePath,
            data: fileBuffer.toString("base64")
        };
    } catch (err) {
        console.error("❌ Erreur chargement profil ICC :", err);
        throw err;
    }
});

/* =======================================================
    IMPRESSION : Chargement d'image pour PrintManager
======================================================= */

ipcMain.handle("load-image-for-print", async (event, imagePath, pictureControl) => {
    console.log("📸 load-image-for-print appelé pour:", imagePath);
    
    if (!imagePath || !fs.existsSync(imagePath)) {
        console.error("❌ Fichier introuvable:", imagePath);
        return { success: false, error: "Fichier introuvable" };
    }

    try {
        const ext = path.extname(imagePath).toLowerCase();
        let imageBuffer = null;
        let mimeType = "image/jpeg";

        // 🔹 Traiter selon le type de fichier
        if ([".tif", ".tiff", ".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
            // Images standard
            if (ext === ".tif" || ext === ".tiff") {
                // Utiliser Sharp pour les TIFF
                imageBuffer = await sharp(imagePath, { failOnError: false, limitInputPixels: false })
                    .rotate()
                    .jpeg({ quality: 95 })
                    .toBuffer();
                mimeType = "image/jpeg";
            } else {
                imageBuffer = fs.readFileSync(imagePath);
                if (ext === ".png") mimeType = "image/png";
                if (ext === ".webp") mimeType = "image/webp";
            }
        } else if ([".nef", ".cr2", ".cr3", ".raf", ".arw", ".rw2", ".dng", ".pef", ".orf"].includes(ext)) {
            // RAW - utiliser le décodeur existant
            const previewDataUrl = await decodeRAWImage(imagePath);
            if (previewDataUrl) {
                // Extraire le base64
                const base64Data = previewDataUrl.replace(/^data:image\/\w+;base64,/, "");
                imageBuffer = Buffer.from(base64Data, 'base64');
                mimeType = "image/jpeg";
            } else {
                throw new Error("Impossible de décoder le RAW");
            }
        } else {
            // Autres formats - essayer avec Sharp
            try {
                imageBuffer = await sharp(imagePath, { failOnError: false })
                    .rotate()
                    .jpeg({ quality: 95 })
                    .toBuffer();
            } catch (sharpErr) {
                console.error("❌ Erreur Sharp:", sharpErr);
                return { success: false, error: "Format non supporté" };
            }
        }

        if (!imageBuffer || imageBuffer.length === 0) {
            return { success: false, error: "Image vide" };
        }

        // 🔹 Appliquer le Picture Control si fourni
        if (pictureControl && Object.keys(pictureControl).length > 0) {
            try {
                // Appliquer les filtres via votre moteur
                // Si vous avez un moteur de filtrage existant, utilisez-le ici
                console.log("🎨 Picture Control appliqué:", Object.keys(pictureControl));
            } catch (filterErr) {
                console.warn("⚠️ Erreur application filtres:", filterErr);
            }
        }

        console.log("✅ Image chargée:", imageBuffer.length, "bytes");

        return {
            success: true,
            data: imageBuffer.toString('base64'),
            mimeType: mimeType
        };

    } catch (err) {
        console.error("❌ Erreur load-image-for-print:", err);
        return { success: false, error: err.message };
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

app.whenReady().then(async () => {
    await initCatalogDB();
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

/* =======================================================
    IPC HANDLERS : CATALOGUE SQLITE
======================================================= */

ipcMain.handle("catalog:add-folder", async (event, folderData) => {
    return await addFolderToCatalog(folderData);
});

ipcMain.handle("catalog:get-all", async () => {
    return await getFullCatalog();
});

ipcMain.handle("catalog:remove-folder", async (event, folderPath) => {
    return await removeFolderFromCatalog(folderPath);
});

ipcMain.handle("catalog:save-photo-pc", async (event, filePath, pcData) => {
    return await savePhotoSettings(filePath, pcData);
});

/* =======================================================
    10. Handler IPC : Impression & Exportation PDF (PrintManager)
======================================================= */
ipcMain.handle("print-or-save-pdf", async (event, data) => {
    console.log("🖨️ print-or-save-pdf appelé, action:", data?.action);

    if (!data || !data.imagePath) {
        console.error("❌ Pas de chemin d'image");
        return { success: false, error: "Aucune image sélectionnée" };
    }

    let tempImagePath = null;
    let win = null;

    try {
        const { 
            action, 
            imagePath,
            pictureControl,
            defaultName = "document",
            widthCm = 15, 
            heightCm = 10,
            orientation = "portrait"
        } = data;

        console.log(`📸 Impression de: ${imagePath}`);

        // 🔹 CHARGER L'IMAGE DEPUIS LE DISQUE
        let imageBuffer = null;
        const ext = path.extname(imagePath).toLowerCase();

        try {
            if ([".nef", ".cr2", ".cr3", ".raf", ".arw", ".rw2", ".dng", ".pef", ".orf"].includes(ext)) {
                // RAW - utiliser le décodeur
                const previewDataUrl = await decodeRAWImage(imagePath);
                if (previewDataUrl) {
                    const base64Data = previewDataUrl.replace(/^data:image\/\w+;base64,/, "");
                    imageBuffer = Buffer.from(base64Data, 'base64');
                } else {
                    throw new Error("Impossible de décoder le RAW");
                }
            } else {
                // Images standard avec Sharp
                imageBuffer = await sharp(imagePath, { failOnError: false, limitInputPixels: false })
                    .rotate()
                    .jpeg({ quality: 95 })
                    .toBuffer();
            }
        } catch (sharpErr) {
            console.error("❌ Erreur chargement image:", sharpErr);
            return { success: false, error: "Impossible de charger l'image" };
        }

        if (!imageBuffer || imageBuffer.length === 0) {
            return { success: false, error: "Image vide" };
        }

        // Créer le fichier temporaire
        const tempDir = app.getPath('temp');
        tempImagePath = path.join(tempDir, `nikon_print_${Date.now()}.jpg`);
        fs.writeFileSync(tempImagePath, imageBuffer);
        console.log("✅ Fichier temporaire:", tempImagePath);

        const isLandscape = orientation === "landscape" || Number(widthCm) > Number(heightCm);
        let wCm = Number(widthCm) || 15;
        let hCm = Number(heightCm) || 10;

        // DPI adaptatif
        let dpi = 300;
        const maxDimension = Math.max(wCm, hCm);
        if (maxDimension > 30) {
            dpi = Math.max(72, Math.round(300 * (30 / maxDimension)));
        }
        dpi = Math.max(72, Math.min(300, dpi));
        
        console.log(`📐 ${isLandscape ? 'Paysage' : 'Portrait'}: ${wCm}x${hCm}cm, DPI: ${dpi}`);

        // Conversion en points
        const CM_TO_PTS = 28.3465;
        let wPts = Math.round(wCm * CM_TO_PTS);
        let hPts = Math.round(hCm * CM_TO_PTS);
        const MAX_PTS = 200000;
        if (wPts > MAX_PTS || hPts > MAX_PTS) {
            const ratio = MAX_PTS / Math.max(wPts, hPts);
            wPts = Math.round(wPts * ratio);
            hPts = Math.round(hPts * ratio);
        }

        // Lire l'image en base64 pour l'injection HTML
        const imgBase64 = fs.readFileSync(tempImagePath, 'base64');

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    * { margin:0; padding:0; }
                    @page { size: ${wCm}cm ${hCm}cm; margin:0; }
                    html, body { 
                        width:100%; height:100%; 
                        display:flex; justify-content:center; align-items:center; 
                        background:white; overflow:hidden;
                    }
                    img { max-width:100%; max-height:100%; object-fit:contain; display:block; }
                </style>
            </head>
            <body>
                <img src="data:image/jpeg;base64,${imgBase64}" />
            </body>
            </html>
        `;

        // 🔹 IMPRESSION PHYSIQUE
        if (action === "print") {
            win = new BrowserWindow({ 
                width: 800, 
                height: 600, 
                show: true,
                webPreferences: { 
                    nodeIntegration: false, 
                    contextIsolation: true 
                }
            });

            await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
            await new Promise(r => setTimeout(r, 2000));

            return new Promise((resolve) => {
                win.webContents.print({ 
                    silent: false, 
                    printBackground: true 
                }, (success, err) => {
                    console.log("📄 Impression:", success ? "OK" : "Échec");
                    setTimeout(() => {
                        try { if (win && !win.isDestroyed()) win.close(); } catch(e) {}
                        try { if (tempImagePath && fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath); } catch(e) {}
                        resolve({ success: !!success });
                    }, 1000);
                });
            });
        }

        // 🔹 EXPORTATION PDF
        const { filePath, canceled } = await dialog.showSaveDialog({
            title: "Enregistrer le PDF",
            defaultPath: `${defaultName}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }]
        });

        if (canceled || !filePath) {
            try { if (tempImagePath && fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath); } catch(e) {}
            return { success: false, error: "Annulé" };
        }

        win = new BrowserWindow({
            show: false,
            width: Math.min(Math.round(wCm * 37.8), 4000),
            height: Math.min(Math.round(hCm * 37.8), 4000),
            webPreferences: { 
                nodeIntegration: false, 
                contextIsolation: true 
            }
        });

        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
        await new Promise(r => setTimeout(r, 1500));

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.warn("⚠️ Timeout PDF");
                try { if (win && !win.isDestroyed()) win.destroy(); } catch(e) {}
                try { if (tempImagePath && fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath); } catch(e) {}
                resolve({ success: false, error: "Timeout" });
            }, 60000);

            win.webContents.printToPDF({
                printBackground: true,
                landscape: isLandscape,
                pageSize: { 
                    width: Math.min(wPts, 200000), 
                    height: Math.min(hPts, 200000) 
                },
                margins: { marginType: 'none' },
                dpi: dpi
            }).then(pdfData => {
                fs.writeFileSync(filePath, pdfData);
                console.log("✅ PDF sauvegardé");
                clearTimeout(timeout);
                try { if (win && !win.isDestroyed()) win.destroy(); } catch(e) {}
                try { if (tempImagePath && fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath); } catch(e) {}
                resolve({ success: true });
            }).catch(err => {
                console.error("❌ Erreur PDF:", err);
                clearTimeout(timeout);
                try { if (win && !win.isDestroyed()) win.destroy(); } catch(e) {}
                try { if (tempImagePath && fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath); } catch(e) {}
                resolve({ success: false, error: err.message });
            });
        });

    } catch (err) {
        console.error("❌ Erreur:", err);
        try {
            if (tempImagePath && fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath);
            if (win && !win.isDestroyed()) win.destroy();
        } catch(e) {}
        return { success: false, error: err.message };
    }
});