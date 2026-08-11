/*=========================================================
    Nikon Picture Control Studio - main1.js (Version Complète avec Persistance)
=========================================================*/

const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const exifr = require('exifr');
const { exiftool } = require('exiftool-vendored');

// 🔹 Imports des services
const { initDatabase, getDb, dbAll, dbRun } = require("./db");
const {
    initCatalogDB,
    addFolderToCatalog,
    getFullCatalog,
    removeFolderFromCatalog,
    savePhotoSettings,
    getPhotoSettings
} = require("./services/catalogService");

// 🔹 Imports pour le décodage RAW (si disponibles)
let decodeRAWImage, readRawFileBuffer, SUPPORTED_EXTENSIONS;
try {
    const rawDecoder = require("./services/rawDecoder");
    decodeRAWImage = rawDecoder.decodeRAWImage;
    readRawFileBuffer = rawDecoder.readRawFileBuffer;
    SUPPORTED_EXTENSIONS = rawDecoder.SUPPORTED_EXTENSIONS || [];
    console.log("✅ rawDecoder chargé");
} catch (err) {
    console.warn("⚠️ rawDecoder non disponible, utilisation du mode standard");
    decodeRAWImage = null;
    readRawFileBuffer = null;
    SUPPORTED_EXTENSIONS = [];
}

// 🔹 Variables globales
let mainWindow = null;
const settingsCache = new Map();

// 🔹 Fonction de scan récursif
const ALL_IMAGE_EXTENSIONS = [
    "nef", "cr2", "cr3", "raf", "arw", "rw2", "dng", "pef", "orf",
    "jpg", "jpeg", "png", "webp", "tif", "tiff"
];

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

// 🔹 Création du menu supérieur
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

function getDefaultPictureControl() {
    return {
        name: "Standard",
        pictureControlName: "Standard",
        baseProfile: "STANDARD",
        basePictureControl: "STANDARD",
        isMonochrome: false,
        wbTemperature: 0,
        wbTint: 0,
        sharpening: 3.25,
        midRangeSharpening: 1,
        clarity: 0,
        contrast: 0,
        brightness: 0,
        saturation: 0,
        hue: 0,
        filterEffect: "OFF",
        toningEffect: "B&W",
        toningAmount: 1,
        exposure: 0,
        blackPoint: 0,
        whitePoint: 255,
        highlights: 0,
        shadows: 0,
        dehaze: 0,
        vibrance: 0,
        vignette: 0,
        denoise: 0,
        lensCorrection: false,
        toneCurveLut: null,
        monoFilter: "None",
        monoToning: "None"
    };
}

// ============================================================
// INITIALISATION
// ============================================================

app.whenReady().then(async () => {
    try {
        console.log("🚀 Démarrage de l'application...");

        const dbPath = path.join(app.getPath("userData"), "catalog.db");
        global.db = await initDatabase(dbPath);
        await initCatalogDB();
        
        // 🔥 CRÉER LA TABLE photo_settings
        try {
            await dbRun(`
                CREATE TABLE IF NOT EXISTS photo_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path TEXT UNIQUE NOT NULL,
                    settings TEXT NOT NULL,
                    date_modified DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log("✅ Table photo_settings créée/vérifiée");
        } catch (tableErr) {
            console.error("❌ Erreur création table photo_settings:", tableErr);
        }
        
        console.log("✅ Base de données et catalogue initialisés.");

        createWindow();
        createAppMenu();
        setupIpcHandlers();

    } catch (err) {
        console.error("❌ Erreur critique au démarrage:", err);
        app.quit();
    }
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile("renderer/index.html");
    mainWindow.webContents.openDevTools();
    console.log("🪟 Fenêtre principale créée.");
}

// ============================================================
// 🔹 CONFIGURATION DES HANDLERS IPC
// ============================================================

function setupIpcHandlers() {

    // ============================================================
    // 📁 GESTION DES FICHIERS ET DOSSIERS
    // ============================================================

    ipcMain.handle("open-nef", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Sélectionner une photo / fichier RAW",
            properties: ["openFile"],
            filters: [
                { name: "Fichiers Images & RAW", extensions: ["nef", "NEF", "jpg", "jpeg", "png"] },
                { name: "Tous les fichiers", extensions: ["*"] }
            ]
        });

        if (result.canceled || !result.filePaths.length) return null;
        
        const filePath = result.filePaths[0];
        const settings = await getPhotoSettings(filePath);
        
        return {
            filePath: filePath,
            settings: settings || null
        };
    });

    ipcMain.handle("select-folder-recursive", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Sélectionner un répertoire de photos",
            properties: ["openDirectory"]
        });

        if (result.canceled || !result.filePaths.length) return null;
        return scanDirectoryRecursive(result.filePaths[0]);
    });

    ipcMain.handle("read-folder-recursive", async (event, folderPath) => {
        if (!folderPath || !fs.existsSync(folderPath)) return null;
        try {
            return scanDirectoryRecursive(folderPath);
        } catch (err) {
            console.error("❌ Erreur lecture dossier sauvegardé :", folderPath, err);
            return null;
        }
    });

    // ============================================================
    // 📖 LECTURE DIRECTE - HANDLER UNIQUE CORRIGÉ
    // ============================================================

        // ============================================================
    // 📖 LECTURE DIRECTE - VERSION CORRIGÉE (conserve le fonctionnement original)
    // ============================================================


ipcMain.handle("read-file-direct", async (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
        console.error("❌ Fichier introuvable:", filePath);
        return null;
    }

    try {
        const ext = path.extname(filePath).toLowerCase();
        console.log("📖 Lecture directe du fichier:", filePath);

        // 🔥 1. Structure de base (comme avant)
        let result = {
            filePath: filePath,
            path: filePath,
            name: path.basename(filePath),
            fileName: path.basename(filePath),
            fullPath: filePath
        };

        // 🔥 2. Traiter les images standards (comme avant)
        if ([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"].includes(ext)) {
            let imageBuffer;
            let mimeType = "image/jpeg";
            
            try {
                const sharp = require('sharp');
                const metadata = await sharp(filePath).metadata();
                console.log(`📷 Image source: ${metadata.width}x${metadata.height}px`);
                
                const previewWidth = Math.min(metadata.width, 1200);
                const previewHeight = Math.round(previewWidth * (metadata.height / metadata.width));
                
                imageBuffer = await sharp(filePath)
                    .resize(previewWidth, previewHeight, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                    
                mimeType = "image/jpeg";
                console.log(`✅ Aperçu généré: ${previewWidth}x${previewHeight}px`);
                
            } catch (sharpErr) {
                console.warn("⚠️ Sharp non disponible, lecture directe:", sharpErr.message);
                imageBuffer = fs.readFileSync(filePath);
            }

            const base64 = imageBuffer.toString("base64");
            result.preview = `data:${mimeType};base64,${base64}`;
            result.isStandardImage = true;
            result.orientation = 1;
            result.fullPath = filePath;
        }
        else if ([".nef", ".cr2", ".cr3", ".raf", ".arw", ".rw2", ".dng", ".pef", ".orf"].includes(ext)) {
            // 🔥 3. Traiter les RAW (comme avant)
            if (decodeRAWImage) {
                try {
                    const previewDataUrl = await decodeRAWImage(filePath);
                    if (previewDataUrl) {
                        result.preview = previewDataUrl;
                        result.isRaw = true;
                        result.orientation = 1;
                    }
                } catch (rawErr) {
                    console.warn("⚠️ Erreur décodage RAW:", rawErr.message);
                }
            }
            result.isRaw = true;
            result.fullPath = filePath;
        }

        // 🔥 4. Charger les réglages (comme avant)
        try {
            const settings = await getPhotoSettings(filePath);
            if (settings) {
                result.settings = settings;
                settingsCache.set(filePath, settings);
                console.log("📂 Réglages chargés pour:", filePath);
            } else {
                result.settings = null;
            }
        } catch (settingsErr) {
            console.warn("⚠️ Pas de réglages pour:", filePath);
            result.settings = null;
        }

        // 🔥 5. AJOUTER LES EXIF AVEC exifr
        try {
            const exif = await exifr.parse(filePath, {
                pick: [
                    'Make', 'Model', 'LensModel', 'Lens', 'ISO', 
                    'FNumber', 'FocalLength', 'ExposureTime', 
                    'ExposureCompensation', 'WhiteBalanceName', 
                    'DateTimeOriginal', 'Orientation'
                ],
                tiff: true,
                exif: true,
                xmp: true
            });
            
            if (exif) {
                result.make = exif.Make || null;
                result.model = exif.Model || null;
                result.lens = exif.LensModel || exif.Lens || null;
                result.iso = exif.ISO || null;
                result.aperture = exif.FNumber || null;
                result.focalLength = exif.FocalLength || null;
                result.shutterSpeed = exif.ExposureTime || null;
                result.exposureCompensation = exif.ExposureCompensation || null;
                result.whiteBalance = exif.WhiteBalanceName || null;
                result.dateTimeOriginal = exif.DateTimeOriginal || null;
                result.orientation = exif.Orientation || 1;
                
                console.log("📸 EXIF extraites (exifr):", { 
                    make: result.make, 
                    model: result.model, 
                    iso: result.iso
                });
            }
        } catch (exifErr) {
            console.warn("⚠️ Erreur extraction EXIF (exifr):", exifErr.message);
        }

        // 🔥 Le ShutterCount (exiftool.read complet) a été retiré d'ici : c'était l'appel
        // le plus lent de ce handler et il bloquait l'affichage de chaque photo à la
        // navigation. Il est désormais récupéré en tâche de fond après affichage, via
        // le handler IPC "get-shutter-count" (voir ci-dessous et renderer/app.js).

        return result;

    } catch (err) {
        console.error("❌ Erreur lecture directe:", err);
        return {
            filePath: filePath,
            path: filePath,
            preview: null,
            name: path.basename(filePath),
            fileName: path.basename(filePath),
            error: err.message,
            settings: null,
            fullPath: filePath
        };
    }
});

    // ============================================================
    // 🔢 SHUTTER COUNT (récupéré en arrière-plan, après affichage)
    // ============================================================
    // Lecture ciblée (pas un exiftool.read() complet) pour rester légère : c'est
    // volontairement un second aller-retour IPC séparé de read-file-direct, pour ne
    // jamais retarder l'affichage initial de la photo et de ses EXIF principales.

ipcMain.handle("get-shutter-count", async (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: "Fichier introuvable" };
    }

    try {
        const metadata = await exiftool.read(filePath, ["ShutterCount", "ImageCount", "TotalShutterReleases", "Model"]);
        const shutterCount = metadata?.ShutterCount ||
                              metadata?.ImageCount ||
                              metadata?.TotalShutterReleases ||
                              null;

        if (shutterCount) {
            console.log("🔢 ShutterCount (arrière-plan) via exiftool:", shutterCount);
        }

        return { success: true, shutterCount: shutterCount ? parseInt(shutterCount) : null };

    } catch (err) {
        console.warn("⚠️ Erreur get-shutter-count:", err.message);
        return { success: false, error: err.message };
    }
});

    // ============================================================
    // 🖼️ IMAGE PLEINE RÉSOLUTION (export / impression uniquement)
    // ============================================================
    // Pour les RAW : le démosaïçage réel (libraw-wasm) se fait côté renderer
    // (nécessite l'API Worker du navigateur, absente du process main). On se
    // contente ici de lire les octets bruts du fichier et de les transmettre.
    // Pour les images standards : lecture à la résolution native (pas de
    // redimensionnement à 1200px comme dans read-file-direct).

ipcMain.handle("get-full-resolution-image", async (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: "Fichier introuvable" };
    }

    const ext = path.extname(filePath).toLowerCase();
    const timerLabel = `⏱️ get-full-resolution-image (${path.basename(filePath)})`;
    console.time(timerLabel);

    try {
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
            if (!readRawFileBuffer) {
                return { success: false, error: "Lecteur RAW indisponible" };
            }
            const buffer = await readRawFileBuffer(filePath);
            console.log(`📦 RAW lu (${(buffer.length / (1024 * 1024)).toFixed(1)} Mo) — décodage délégué au renderer`);
            return { success: true, isRaw: true, ext, rawBytes: buffer };
        }

        if ([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"].includes(ext)) {
            const sharp = require("sharp");
            const metadata = await sharp(filePath).metadata();
            const imageBuffer = await sharp(filePath)
                .jpeg({ quality: 95 })
                .toBuffer();
            console.log(`✅ Image pleine résolution chargée : ${metadata.width}x${metadata.height}px`);
            return {
                success: true,
                isRaw: false,
                dataUrl: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`
            };
        }

        return { success: false, error: `Extension non prise en charge : ${ext}` };

    } catch (err) {
        console.error("❌ Erreur get-full-resolution-image:", err);
        return { success: false, error: err.message };
    } finally {
        console.timeEnd(timerLabel);
    }
});

    // ============================================================
    // 💾 SAUVEGARDE ET CHARGEMENT DES RÉGLAGES
    // ============================================================

    ipcMain.handle("catalog:save-photo-pc", async (event, filePath, pcData) => {
        try {
            console.log("💾 Sauvegarde des réglages pour:", filePath);
            const result = await savePhotoSettings(filePath, pcData);
            if (result && result.success !== false) {
                settingsCache.set(filePath, pcData);
                console.log("✅ Réglages sauvegardés et mis en cache");
            }
            return result;
        } catch (err) {
            console.error("❌ Erreur sauvegarde:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("catalog:save-settings", async (event, filePath, settings) => {
        try {
            if (!filePath || !settings) {
                return { success: false, error: "Paramètres manquants" };
            }
            
            console.log("💾 Sauvegarde automatique des réglages pour:", filePath);
            const result = await savePhotoSettings(filePath, settings);
            
            if (result && result.success !== false) {
                settingsCache.set(filePath, settings);
                console.log("✅ Réglages sauvegardés automatiquement");
            }
            
            return result;
        } catch (err) {
            console.error("❌ Erreur sauvegarde automatique:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("get-photo-settings", async (event, filePath) => {
        try {
            if (settingsCache.has(filePath)) {
                console.log("📂 Réglages chargés depuis le cache:", filePath);
                return settingsCache.get(filePath);
            }
            
            const settings = await getPhotoSettings(filePath);
            if (settings) {
                settingsCache.set(filePath, settings);
                console.log("📂 Réglages chargés depuis la base:", filePath);
            } else {
                console.log("📂 Aucun réglage trouvé pour:", filePath);
            }
            return settings;
        } catch (err) {
            console.error("❌ Erreur lecture réglages:", err);
            return null;
        }
    });

    ipcMain.handle("get-settings-for-print", async (event, filePath) => {
        try {
            if (settingsCache.has(filePath)) {
                return settingsCache.get(filePath);
            }
            const settings = await getPhotoSettings(filePath);
            if (settings) {
                settingsCache.set(filePath, settings);
            }
            return settings;
        } catch (err) {
            console.error("❌ Erreur chargement réglages pour impression:", err);
            return null;
        }
    });

    ipcMain.handle("pc-reset", async (event) => {
        try {
            console.log("🔄 Reset des réglages demandé pour la photo active");
            
            const filePath = event.sender?.currentFilePath || global.currentStudioFilePath;
            
            if (!filePath) {
                console.warn("⚠️ Aucun fichier actif pour le reset");
                return getDefaultPictureControl();
            }
            
            const defaultSettings = getDefaultPictureControl();
            const result = await savePhotoSettings(filePath, defaultSettings);
            
            if (result && result.success !== false) {
                console.log("✅ Réglages réinitialisés pour:", filePath);
                settingsCache.set(filePath, defaultSettings);
            }
            
            return defaultSettings;
        } catch (err) {
            console.error("❌ Erreur reset des réglages:", err);
            return getDefaultPictureControl();
        }
    });

    // ============================================================
    // 🖼️ LECTURE ET DÉCODAGE DES IMAGES
    // ============================================================

    ipcMain.handle("decode-raw", async (event, filePath) => {
        try {
            console.log("📷 Decode-raw appelé pour:", filePath);
            
            if (decodeRAWImage) {
                const imageDataUrl = await decodeRAWImage(filePath);
                if (imageDataUrl) {
                    return { success: true, data: imageDataUrl };
                }
            }
            
            const ext = path.extname(filePath).toLowerCase();
            if ([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"].includes(ext)) {
                const fileBuffer = fs.readFileSync(filePath);
                const base64 = fileBuffer.toString("base64");
                let mimeType = "image/jpeg";
                if (ext === ".png") mimeType = "image/png";
                if (ext === ".webp") mimeType = "image/webp";
                if (ext === ".tif" || ext === ".tiff") mimeType = "image/tiff";
                
                return { success: true, data: `data:${mimeType};base64,${base64}` };
            }
            
            return { success: false, error: "Format non supporté" };
        } catch (error) {
            console.error("❌ Erreur handler decode-raw :", error);
            return { success: false, error: error.message };
        }
    });

    // ============================================================
    // 🖨️ LOAD IMAGE FOR PRINT
    // ============================================================

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

            let savedSettings = null;
            try {
                savedSettings = await getPhotoSettings(imagePath);
                if (savedSettings) {
                    console.log("📂 Réglages trouvés pour l'impression:", Object.keys(savedSettings));
                }
            } catch (settingsErr) {
                console.warn("⚠️ Erreur chargement réglages pour impression:", settingsErr);
            }

            if ([".tif", ".tiff", ".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
                try {
                    const sharp = require('sharp');
                    if (ext === ".tif" || ext === ".tiff") {
                        imageBuffer = await sharp(imagePath, { failOnError: false, limitInputPixels: false })
                            .rotate()
                            .jpeg({ quality: 98 })
                            .toBuffer();
                        mimeType = "image/jpeg";
                    } else {
                        imageBuffer = fs.readFileSync(imagePath);
                        if (ext === ".png") mimeType = "image/png";
                        if (ext === ".webp") mimeType = "image/webp";
                    }
                } catch (sharpErr) {
                    console.warn("⚠️ Sharp non disponible:", sharpErr.message);
                    imageBuffer = fs.readFileSync(imagePath);
                }
            } else if ([".nef", ".cr2", ".cr3", ".raf", ".arw", ".rw2", ".dng", ".pef", ".orf"].includes(ext)) {
                if (decodeRAWImage) {
                    const previewDataUrl = await decodeRAWImage(imagePath);
                    if (previewDataUrl) {
                        const base64Data = previewDataUrl.replace(/^data:image\/\w+;base64,/, "");
                        imageBuffer = Buffer.from(base64Data, 'base64');
                        mimeType = "image/jpeg";
                    }
                }
                if (!imageBuffer) {
                    throw new Error("Impossible de décoder le RAW");
                }
            }

            if (!imageBuffer || imageBuffer.length === 0) {
                return { success: false, error: "Image vide" };
            }

            console.log("✅ Image chargée:", imageBuffer.length, "bytes");

            return {
                success: true,
                data: imageBuffer.toString('base64'),
                mimeType: mimeType,
                settings: savedSettings || null
            };

        } catch (err) {
            console.error("❌ Erreur load-image-for-print:", err);
            return { success: false, error: err.message };
        }
    });

    // ============================================================
    // 💾 SAVE JPEG
    // ============================================================

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

            const { filePath, canceled } = await dialog.showSaveDialog(win || mainWindow, {
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

    // ============================================================
    // 🖨️ IMPRESSION ET EXPORT PDF
    // ============================================================

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
                imageDataUrl,
                pictureControl,
                defaultName = "document",
                widthCm = 15,
                heightCm = 10,
                orientation = "portrait"
            } = data;

            console.log(`📸 Impression de: ${imagePath}`);

            // Charger l'image
            let imageBuffer = null;

            // 🔹 PRIORITÉ à l'image DÉJÀ TRAITÉE reçue depuis le Studio
            // (mêmes réglages que l'export JPEG : exposition, contraste, Picture Control...).
            // Évite de retraiter le fichier brut depuis le disque, ce qui effaçait
            // les modifications de traitement appliquées par l'utilisateur.
            if (imageDataUrl) {
                try {
                    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
                    imageBuffer = Buffer.from(base64Data, 'base64');
                    console.log("✅ Image traitée reçue depuis le Studio (réglages appliqués), taille:", imageBuffer.length, "octets");
                } catch (decodeErr) {
                    console.warn("⚠️ Erreur décodage imageDataUrl, repli sur le fichier disque:", decodeErr);
                    imageBuffer = null;
                }
            }

            // 🔹 Repli (ancien comportement) : uniquement si aucune image traitée n'a été fournie.
            if (!imageBuffer) {
                console.warn("⚠️ Aucune image traitée fournie : rechargement du fichier brut depuis le disque " +
                    "(les réglages de traitement en cours ne seront pas appliqués).");
                const ext = path.extname(imagePath).toLowerCase();

                try {
                    const sharp = require('sharp');
                    if ([".nef", ".cr2", ".cr3", ".raf", ".arw", ".rw2", ".dng", ".pef", ".orf"].includes(ext)) {
                        if (decodeRAWImage) {
                            const previewDataUrl = await decodeRAWImage(imagePath);
                            if (previewDataUrl) {
                                const base64Data = previewDataUrl.replace(/^data:image\/\w+;base64,/, "");
                                imageBuffer = Buffer.from(base64Data, 'base64');
                            }
                        }
                    }
                    if (!imageBuffer) {
                        imageBuffer = await sharp(imagePath, { failOnError: false, limitInputPixels: false })
                            .rotate()
                            .jpeg({ quality: 95 })
                            .toBuffer();
                    }
                } catch (sharpErr) {
                    console.error("❌ Erreur chargement image:", sharpErr);
                    return { success: false, error: "Impossible de charger l'image" };
                }
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

            let dpi = 300;
            const maxDimension = Math.max(wCm, hCm);
            if (maxDimension > 30) {
                dpi = Math.max(72, Math.round(300 * (30 / maxDimension)));
            }
            dpi = Math.max(72, Math.min(300, dpi));
            
            console.log(`📐 ${isLandscape ? 'Paysage' : 'Portrait'}: ${wCm}x${hCm}cm, DPI: ${dpi}`);

            const CM_TO_PTS = 28.3465;
            let wPts = Math.round(wCm * CM_TO_PTS);
            let hPts = Math.round(hCm * CM_TO_PTS);

            const MAX_PTS = 14400;
            const MIN_PTS = 72;

            if (wPts > MAX_PTS) wPts = MAX_PTS;
            if (hPts > MAX_PTS) hPts = MAX_PTS;
            if (wPts < MIN_PTS) wPts = MIN_PTS;
            if (hPts < MIN_PTS) hPts = MIN_PTS;

            console.log(`📐 Dimensions PDF: ${wPts}x${hPts} points`);

            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <style>
                        * { margin:0; padding:0; }
                        @page { 
                            size: ${wCm}cm ${hCm}cm; 
                            margin:0; 
                        }
                        html, body { 
                            width:100%; 
                            height:100%; 
                            display:flex; 
                            justify-content:center; 
                            align-items:center; 
                            background:white; 
                            overflow:hidden;
                        }
                        img { 
                            max-width:100%; 
                            max-height:100%; 
                            object-fit:contain; 
                            display:block; 
                        }
                    </style>
                </head>
                <body>
                    <img src="file:///${tempImagePath.replace(/\\/g, '/')}" />
                </body>
                </html>
            `;

            const tempHtmlPath = path.join(tempDir, `nikon_print_${Date.now()}.html`);
            fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');
            console.log("✅ Fichier HTML temporaire:", tempHtmlPath);

            if (action === "print") {
                win = new BrowserWindow({ 
                    width: 800, 
                    height: 600, 
                    show: true,
                    webPreferences: { 
                        nodeIntegration: false, 
                        contextIsolation: true,
                        webSecurity: false
                    }
                });

                await win.loadFile(tempHtmlPath);
                await new Promise(r => setTimeout(r, 2000));

                // 🔹 Toujours passer par la boîte de dialogue Windows : c'est elle qui
                // donne accès au bouton "Propriétés/Préférences" du pilote imprimante
                // (bac papier, type de papier, profil ICC), indispensable pour une
                // imprimante photo comme la Canon PRO-300.
                const printOptions = { silent: false, printBackground: true };

                console.log("🖨️ Impression via la boîte de dialogue Windows");

                return new Promise((resolve) => {
                    win.webContents.print(printOptions, (success, err) => {
                        console.log("📄 Impression:", success ? "OK" : `Échec (${err || "inconnu"})`);
                        setTimeout(() => {
                            cleanup(tempImagePath, tempHtmlPath, win);
                            resolve({ success: !!success, error: success ? undefined : err });
                        }, 1000);
                    });
                });
            }

            // Export PDF
            const { filePath, canceled } = await dialog.showSaveDialog({
                title: "Enregistrer le PDF",
                defaultPath: `${defaultName}.pdf`,
                filters: [{ name: 'PDF', extensions: ['pdf'] }]
            });

            if (canceled || !filePath) {
                cleanup(tempImagePath, tempHtmlPath, win);
                return { success: false, error: "Annulé" };
            }

            win = new BrowserWindow({
                show: false,
                width: Math.min(Math.round(wCm * 37.8), 4000),
                height: Math.min(Math.round(hCm * 37.8), 4000),
                webPreferences: { 
                    nodeIntegration: false, 
                    contextIsolation: true,
                    webSecurity: false
                }
            });

            await win.loadFile(tempHtmlPath);
            await new Promise(r => setTimeout(r, 1500));

            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.warn("⚠️ Timeout PDF");
                    cleanup(tempImagePath, tempHtmlPath, win);
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
                    cleanup(tempImagePath, tempHtmlPath, win);
                    resolve({ success: true });
                }).catch(err => {
                    console.error("❌ Erreur PDF:", err);
                    clearTimeout(timeout);
                    cleanup(tempImagePath, tempHtmlPath, win);
                    resolve({ success: false, error: err.message });
                });
            });

        } catch (err) {
            console.error("❌ Erreur:", err);
            cleanup(tempImagePath, tempHtmlPath, win);
            return { success: false, error: err.message };
        }
    });

    // ============================================================
    // 📚 GESTION DU CATALOGUE
    // ============================================================

    ipcMain.handle("catalog:add-folder", async (event, folderData) => {
        try {
            return await addFolderToCatalog(folderData);
        } catch (err) {
            console.error("❌ Erreur ajout dossier au catalogue:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("catalog:get-all", async () => {
        try {
            return await getFullCatalog();
        } catch (err) {
            console.error("❌ Erreur récupération catalogue:", err);
            return [];
        }
    });

    ipcMain.handle("catalog:remove-folder", async (event, folderPath) => {
        try {
            return await removeFolderFromCatalog(folderPath);
        } catch (err) {
            console.error("❌ Erreur suppression dossier:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("catalog:get-folders", async () => {
        try {
            return await dbAll("SELECT * FROM catalog_folders ORDER BY folder_name ASC");
        } catch (err) {
            console.error("❌ Erreur récupération dossiers catalogue:", err);
            return [];
        }
    });

    ipcMain.handle("catalog:get-photos", async (event, folderPath) => {
        try {
            let query = "SELECT * FROM catalog_photos ORDER BY id DESC";
            let params = [];

            if (folderPath && folderPath !== "ALL") {
                query = "SELECT * FROM catalog_photos WHERE folder_path = ? ORDER BY id DESC";
                params = [folderPath];
            }

            const photos = await dbAll(query, params);
            const cacheDir = path.join(app.getPath("userData"), "thumbnails_cache");

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
            console.error("❌ Erreur récupération photos catalogue:", err);
            return [];
        }
    });

    // ============================================================
    // 🎨 PICTURE CONTROL - NP3
    // ============================================================


   

    ipcMain.handle("export-ncp", async (event, pcData) => {
        try {
            const defaultName = pcData?.name || "picture-control";
            
            const { filePath, canceled } = await dialog.showSaveDialog({
                title: "Exporter le Picture Control (.NCP)",
                defaultPath: `${defaultName}.ncp`,
                filters: [
                    { name: "Picture Control Nikon NCP", extensions: ["ncp"] }
                ]
            });

            if (canceled || !filePath) {
                return { success: false };
            }

            // Créer un fichier NCP (format texte simple pour l'instant)
            const content = JSON.stringify(pcData, null, 2);
            fs.writeFileSync(filePath, content, 'utf8');
            
            return { success: true, filePath };
        } catch (err) {
            console.error("❌ Erreur export NCP:", err);
            return { success: false, error: err.message };
        }
    });

    // ============================================================
    // 🎨 PICTURE CONTROL - NP3 / NCP
    // ============================================================

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
            const filePath = result.filePaths[0];
            const fileBuffer = fs.readFileSync(filePath);
            const fileName = path.basename(filePath);
            
            return {
                success: true,
                filePath: filePath,
                fileName: fileName,
                data: fileBuffer.toString('base64')
            };
        } catch (err) {
            console.error("❌ Erreur chargement NP3/NCP :", err);
            throw err;
        }
    });


    ipcMain.handle("dialog:saveNP3", async (event, data) => {
        try {
            const defaultName = data?.name || "picture-control";
            
            const { filePath, canceled } = await dialog.showSaveDialog({
                title: "Exporter le Picture Control (.NP3)",
                defaultPath: `${defaultName}.np3`,
                filters: [
                    { name: "Picture Control Nikon NP3", extensions: ["np3"] }
                ]
            });

            if (canceled || !filePath) {
                return { success: false };
            }

            // Créer un fichier NP3 (format texte simple)
            const content = JSON.stringify(data, null, 2);
            fs.writeFileSync(filePath, content, 'utf8');
            
            return { success: true, filePath };
        } catch (err) {
            console.error("❌ Erreur export NP3:", err);
            return { success: false, error: err.message };
        }
    });

    // ============================================================
    // 🗂️ AUTRES
    // ============================================================

    ipcMain.handle("dialog:selectExportFolder", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Sélectionner le dossier de destination",
            properties: ["openDirectory"]
        });
        return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle("print-export-jpeg", async (event, data) => {
        try {
            const { imagePath, settings, defaultName = "export" } = data;
            
            if (!imagePath || !fs.existsSync(imagePath)) {
                return { success: false, error: "Fichier introuvable" };
            }
            
            const ext = path.extname(imagePath).toLowerCase();
            let imageBuffer = null;
            
            try {
                const sharp = require('sharp');
                let pipeline = sharp(imagePath, { failOnError: false, limitInputPixels: false });
                
                if (settings) {
                    if (settings.contrast) {
                        pipeline = pipeline.linear(1 + (settings.contrast / 100), 0);
                    }
                    if (settings.brightness) {
                        pipeline = pipeline.linear(1 + (settings.brightness / 100), 0);
                    }
                    if (settings.saturation) {
                        pipeline = pipeline.modulate({ saturation: 1 + (settings.saturation / 100) });
                    }
                    if (settings.sharpening) {
                        const sigma = 0.5 + (settings.sharpening / 20);
                        pipeline = pipeline.sharpen({ sigma: Math.min(sigma, 3) });
                    }
                }
                
                imageBuffer = await pipeline.jpeg({ quality: 95 }).toBuffer();
            } catch (err) {
                imageBuffer = fs.readFileSync(imagePath);
            }
            
            const { filePath, canceled } = await dialog.showSaveDialog({
                title: "Exporter l'image",
                defaultPath: `${defaultName}.jpg`,
                filters: [
                    { name: "Image JPEG", extensions: ["jpg", "jpeg"] },
                    { name: "Image PNG", extensions: ["png"] },
                    { name: "Image WebP", extensions: ["webp"] }
                ]
            });
            
            if (canceled || !filePath) {
                return { success: false, error: "Annulé" };
            }
            
            fs.writeFileSync(filePath, imageBuffer);
            return { success: true, filePath: filePath };
            
        } catch (err) {
            console.error("❌ Erreur export JPEG:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("loadICC", async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: "Importer un profil ICC",
                properties: ["openFile"],
                filters: [
                    { name: "Profil ICC / ICM", extensions: ["icc", "icm"] }
                ]
            });

            if (result.canceled || !result.filePaths.length) return null;

            const filePath = result.filePaths[0];
            const fileName = path.basename(filePath);
            
            return {
                success: true,
                filePath: filePath,
                fileName: fileName
            };
        } catch (err) {
            console.error("❌ Erreur import ICC:", err);
            return null;
        }
    });

} // FIN DE setupIpcHandlers()

// ============================================================
// 🔹 FONCTION DE NETTOYAGE
// ============================================================

function cleanup(tempImagePath, tempHtmlPath, win) {
    try {
        if (tempImagePath && fs.existsSync(tempImagePath)) {
            fs.unlinkSync(tempImagePath);
            console.log(`🗑️ Fichier image supprimé: ${tempImagePath}`);
        }
    } catch (e) {}
    try {
        if (tempHtmlPath && fs.existsSync(tempHtmlPath)) {
            fs.unlinkSync(tempHtmlPath);
            console.log(`🗑️ Fichier HTML supprimé: ${tempHtmlPath}`);
        }
    } catch (e) {}
    try {
        if (win && !win.isDestroyed()) {
            win.destroy();
            console.log(`🗑️ Fenêtre fermée`);
        }
    } catch (e) {}
}

// ============================================================
// 🔹 Gestion de la fermeture
// ============================================================

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

console.log("✅ main.js chargé avec persistance des réglages Picture Control");