/*=========================================================
    Nikon Picture Control Studio - main1.js (Version Complète avec Persistance)
=========================================================*/

const { app, BrowserWindow, ipcMain, dialog, Menu, screen, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const exifr = require('exifr');
const { exiftool } = require('exiftool-vendored');

// 🔹 Imports des services
const { initDatabase, getDb, closeDatabase, dbAll, dbRun } = require("./db");
const {
    DB_PATH: CATALOG_DB_PATH,
    initCatalogDB,
    closeCatalogDB,
    addFolderToCatalog,
    getFullCatalog,
    removeFolderFromCatalog,
    addSingleFileToCatalog,
    savePhotoSettings,
    getPhotoSettings,
    getCatalogStats
} = require("./services/catalogService");

// 🔹 Gestion colorimétrique export/impression (conversion ICC réelle, voir Partie 4)
const { convertBufferColorSpace, checkIccProfilesAvailability } = require("./services/colorManagement");

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
let windowStateStore = null; // instance electron-store, initialisée dans app.whenReady() (module ESM)
let studioPreferencesStore = null; // instance electron-store séparée, pour les préférences Studio (qualité d'aperçu, etc.)
const settingsCache = new Map();

// 🔹 Qualité d'aperçu Studio : largeur max (px) du redimensionnement appliqué par
// read-file-direct. N'affecte QUE l'aperçu du Studio (voir read-file-direct plus
// bas) — jamais get-full-resolution-image (export/impression), qui décode toujours
// à la résolution native.
const PREVIEW_QUALITY_OPTIONS = [
    { id: "fast", label: "Rapide (800px)", maxWidth: 800 },
    { id: "normal", label: "Normal (1200px)", maxWidth: 1200 },
    { id: "high", label: "Élevée (1800px)", maxWidth: 1800 }
];
const DEFAULT_PREVIEW_MAX_WIDTH = 1200;

function getPreviewQualityMaxWidth() {
    return studioPreferencesStore ? studioPreferencesStore.get("previewMaxWidth", DEFAULT_PREVIEW_MAX_WIDTH) : DEFAULT_PREVIEW_MAX_WIDTH;
}

// 🔹 Fenêtre principale : dimensions par défaut et bornes
const DEFAULT_WINDOW_WIDTH = 1200;
const DEFAULT_WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 600;
const WINDOW_SCREEN_MARGIN = 40; // marge pour ne pas coller aux bords de la zone utile
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 400;

// 🔹 Fonction de scan récursif
const ALL_IMAGE_EXTENSIONS = [
    "nef", "cr2", "cr3", "raf", "arw", "rw2", "dng", "pef", "orf",
    "jpg", "jpeg", "png", "webp", "tif", "tiff"
];

function countFilesInTree(node) {
    if (!node) return 0;
    let count = node.files ? node.files.length : 0;
    if (node.children) {
        for (const child of node.children) count += countFilesInTree(child);
    }
    return count;
}

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

// 🔹 Gestionnaire de Profils : option secondaire, uniquement sous Fichier
// (plus d'accès direct dans la barre du haut).
const PROFILE_MANAGER_MENU_LABEL = "Gestionnaire de profils pour Nikon";

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
                { type: "separator" },
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
                },
                {
                    label: "Sauvegarde base de données",
                    submenu: [
                        {
                            label: "Exporter la base...",
                            click: () => {
                                if (mainWindow) mainWindow.webContents.send("menu-export-backup");
                            }
                        },
                        {
                            label: "Importer une sauvegarde...",
                            click: () => {
                                if (mainWindow) mainWindow.webContents.send("menu-import-backup");
                            }
                        }
                    ]
                },
                {
                    label: "Paramètres",
                    click: () => {
                        if (mainWindow) mainWindow.webContents.send("menu-open-settings");
                    }
                },
                {
                    label: PROFILE_MANAGER_MENU_LABEL,
                    click: () => {
                        if (mainWindow) mainWindow.webContents.send("menu-switch-view", "view-profiles");
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
            label: "Programmes externes",
            submenu: [
                {
                    label: "Configurer...",
                    click: () => {
                        if (mainWindow) mainWindow.webContents.send("menu-open-external-programs-config");
                    }
                }
            ]
        },
        {
            label: "Aide",
            submenu: [
                {
                    label: "Bientôt disponible",
                    enabled: false
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

// 🔹 Table photo_settings : créée au démarrage, et re-créée après une restauration
// de sauvegarde (le fichier importé peut être une base plus ancienne qui ne l'a pas).
async function ensurePhotoSettingsTable() {
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

    // 🔥 Migration : colonnes note (rating) et statut (flag), ajoutées à la volée
    // si absentes (ex: base plus ancienne restaurée depuis une sauvegarde).
    for (const migration of [
        "ALTER TABLE photo_settings ADD COLUMN rating INTEGER DEFAULT 0",
        "ALTER TABLE photo_settings ADD COLUMN flag TEXT DEFAULT NULL"
    ]) {
        try {
            await dbRun(migration);
        } catch (alterErr) {
            if (!alterErr.message.includes("duplicate column name")) {
                console.warn("⚠️ Erreur migration photo_settings:", alterErr.message);
            }
        }
    }
}

// 🔹 Note (0-5) et statut ('validated' | 'rejected' | null) par photo.
//
// Stockés dans la table photo_settings (connexion db.js / global.db), PAS dans
// catalog_photos (connexion catalogService.js) : catalog_photos exige une ligne
// déjà existante pour le file_path (créée uniquement à l'import d'un dossier
// dans le Catalogue via addFolderToCatalog), donc UPDATE catalog_photos ... WHERE
// file_path = ? ne fait rien pour un fichier ouvert hors catalogue. photo_settings
// a une contrainte UNIQUE(file_path) et supporte un vrai UPSERT, donc fonctionne
// pour n'importe quel fichier, catalogué ou non — ce que demande cette fonctionnalité.
async function setPhotoRatingValue(filePath, rating) {
    const safeRating = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
    await dbRun(
        `INSERT INTO photo_settings (file_path, settings, rating) VALUES (?, '{}', ?)
         ON CONFLICT(file_path) DO UPDATE SET rating = excluded.rating, date_modified = CURRENT_TIMESTAMP`,
        [filePath, safeRating]
    );
    return safeRating;
}

async function setPhotoFlagValue(filePath, flag) {
    const safeFlag = (flag === "validated" || flag === "rejected") ? flag : null;
    await dbRun(
        `INSERT INTO photo_settings (file_path, settings, flag) VALUES (?, '{}', ?)
         ON CONFLICT(file_path) DO UPDATE SET flag = excluded.flag, date_modified = CURRENT_TIMESTAMP`,
        [filePath, safeFlag]
    );
    return safeFlag;
}

app.whenReady().then(async () => {
    try {
        console.log("🚀 Démarrage de l'application...");

        // electron-store v10+ est un module ESM pur : impossible de le charger avec
        // require() depuis ce fichier CommonJS, d'où l'import() dynamique ici.
        const { default: Store } = await import("electron-store");
        windowStateStore = new Store({ name: "window-state" });
        studioPreferencesStore = new Store({ name: "studio-preferences" });

        global.db = await initDatabase(CATALOG_DB_PATH);
        await initCatalogDB();
        await ensurePhotoSettingsTable();

        console.log("✅ Base de données et catalogue initialisés.");

        createWindow();
        createAppMenu();
        setupIpcHandlers();

    } catch (err) {
        console.error("❌ Erreur critique au démarrage:", err);
        app.quit();
    }
});

// 🔹 Taille par défaut, contrainte à la zone utile de l'écran principal
// (barre des tâches Windows déjà exclue par workAreaSize).
function getDefaultWindowBounds() {
    const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize;
    return {
        width: Math.min(DEFAULT_WINDOW_WIDTH, workAreaWidth - WINDOW_SCREEN_MARGIN),
        height: Math.min(DEFAULT_WINDOW_HEIGHT, workAreaHeight - WINDOW_SCREEN_MARGIN)
    };
}

// 🔹 Bornes initiales : reprend la position/taille sauvegardée si elle correspond
// encore à un écran actuellement connecté (sinon l'utilisateur a changé de moniteur
// entre deux lancements et on retombe sur le calcul par défaut).
function getInitialWindowBounds() {
    const defaults = getDefaultWindowBounds();
    const saved = windowStateStore ? windowStateStore.get("windowBounds") : null;

    if (!saved || typeof saved.x !== "number" || typeof saved.y !== "number" ||
        typeof saved.width !== "number" || typeof saved.height !== "number") {
        return defaults;
    }

    const fitsInADisplay = screen.getAllDisplays().some((display) => {
        const area = display.workArea;
        return (
            saved.x >= area.x &&
            saved.y >= area.y &&
            saved.x + saved.width <= area.x + area.width &&
            saved.y + saved.height <= area.y + area.height
        );
    });

    return fitsInADisplay ? saved : defaults;
}

function createWindow() {
    const bounds = getInitialWindowBounds();

    mainWindow = new BrowserWindow({
        ...bounds,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        icon: path.join(__dirname, "assets/icons/pixelraw.ico"),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // 🔹 Sauvegarde débattue (debounce) de la position/taille entre les sessions.
    let saveStateTimeout = null;
    const saveWindowState = () => {
        if (!windowStateStore || !mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMaximized() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
        windowStateStore.set("windowBounds", mainWindow.getBounds());
    };
    const debouncedSaveWindowState = () => {
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(saveWindowState, WINDOW_STATE_SAVE_DEBOUNCE_MS);
    };

    mainWindow.on("resize", debouncedSaveWindowState);
    mainWindow.on("move", debouncedSaveWindowState);
    mainWindow.on("close", () => {
        clearTimeout(saveStateTimeout);
        saveWindowState();
    });

    mainWindow.loadFile("renderer/index.html");
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }

    console.log("🪟 Fenêtre principale créée.");
}

// ============================================================
// 🔹 CONFIGURATION DES HANDLERS IPC
// ============================================================

function setupIpcHandlers() {

    // ============================================================
    // 🔗 OUVERTURE DE LIENS EXTERNES (navigateur système, pas Electron)
    // ============================================================
    const ALLOWED_EXTERNAL_HOSTS = ["www.pixelphotographie.com", "pixelphotographie.com"];

    ipcMain.handle("open-external-link", async (event, url) => {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== "https:" || !ALLOWED_EXTERNAL_HOSTS.includes(parsed.hostname)) {
                throw new Error("URL non autorisée");
            }
            await shell.openExternal(parsed.toString());
            return { success: true };
        } catch (err) {
            console.error("❌ Erreur ouverture lien externe:", err.message);
            return { success: false, error: err.message };
        }
    });

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

        const tree = scanDirectoryRecursive(result.filePaths[0]);
        console.log(`🔍 Dossier scanné : ${result.filePaths[0]} — ${countFilesInTree(tree)} fichier(s) image`);

        return tree;
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


ipcMain.handle("read-file-direct", async (event, filePath, maxWidth = 1200) => {
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
                
                const effectiveMaxWidth = (typeof maxWidth === "number" && maxWidth > 0) ? maxWidth : 1200;
                const previewWidth = Math.min(metadata.width, effectiveMaxWidth);
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

        // 🔹 Repli exiftool pour l'objectif : exifr ne décode pas les données
        // objectif propriétaires Nikon (MakerNote LensData chiffré/binaire) pour
        // certains couples boîtier/objectif (confirmé sur un AF-P DX 18-55mm —
        // exifr ne trouve AUCUN champ "lens" du tout, même en parsing complet),
        // alors qu'exiftool (déjà vendorisé et utilisé ailleurs, voir
        // services/rawDecoder.js) le résout via sa table de correspondance
        // LensID. Repli ciblé (lecture de 4 tags, pas un exiftool.read()
        // complet), uniquement si exifr n'a rien trouvé.
        if (!result.lens) {
            try {
                const lensTags = await exiftool.read(filePath, ["LensID", "LensModel", "Lens", "LensSpec"]);
                result.lens = lensTags.LensID || lensTags.LensModel || lensTags.Lens || null;
                if (result.lens) {
                    console.log("📸 Objectif retrouvé via exiftool (repli) :", result.lens);
                }
            } catch (lensErr) {
                console.warn("⚠️ Erreur extraction objectif (repli exiftool):", lensErr.message);
            }
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
    // ⚙️ QUALITÉ D'APERÇU STUDIO (lue et réglée par le sélecteur "Résolution"
    // dans l'en-tête de la zone photo, en mode Photo)
    // ============================================================

    ipcMain.handle("get-preview-quality", async () => {
        return getPreviewQualityMaxWidth();
    });

    ipcMain.handle("set-preview-quality", async (event, maxWidth) => {
        const isValid = PREVIEW_QUALITY_OPTIONS.some((option) => option.maxWidth === maxWidth);
        if (isValid && studioPreferencesStore) {
            studioPreferencesStore.set("previewMaxWidth", maxWidth);
        }
        return getPreviewQualityMaxWidth();
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
    // 🖼️ VIGNETTE LÉGÈRE (grille de la Galerie)
    // ============================================================
    // Handler dédié, séparé de read-file-direct : pas de redimensionnement à
    // 1200px, pas d'extraction EXIF, pas de ShutterCount — juste un JPEG 300px
    // de large max, nettement plus rapide pour peupler une grille de vignettes.

    ipcMain.handle("get-thumbnail", async (event, filePath) => {
        if (!filePath || !fs.existsSync(filePath)) {
            return { success: false };
        }

        try {
            const ext = path.extname(filePath).toLowerCase();
            const sharp = require("sharp");

            if (SUPPORTED_EXTENSIONS.includes(ext)) {
                if (!decodeRAWImage) {
                    return { success: false };
                }
                const previewDataUrl = await decodeRAWImage(filePath);
                if (!previewDataUrl) return { success: false };

                const base64Data = previewDataUrl.replace(/^data:image\/\w+;base64,/, "");
                const previewBuffer = Buffer.from(base64Data, "base64");

                const thumbBuffer = await sharp(previewBuffer)
                    .resize(300, null, { fit: "inside", withoutEnlargement: true })
                    .jpeg({ quality: 75 })
                    .toBuffer();

                return { success: true, dataUrl: `data:image/jpeg;base64,${thumbBuffer.toString("base64")}` };
            }

            if ([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"].includes(ext)) {
                const thumbBuffer = await sharp(filePath, { failOnError: false })
                    .resize(300, null, { fit: "inside", withoutEnlargement: true })
                    .jpeg({ quality: 75 })
                    .toBuffer();

                return { success: true, dataUrl: `data:image/jpeg;base64,${thumbBuffer.toString("base64")}` };
            }

            return { success: false };
        } catch (err) {
            console.warn("⚠️ Erreur get-thumbnail:", filePath, err.message);
            return { success: false, error: err.message };
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
    // ⭐ NOTATION & STATUT DES PHOTOS
    // ============================================================

    ipcMain.handle("set-photo-rating", async (event, filePath, rating) => {
        if (!filePath) return { success: false, error: "Chemin de fichier manquant" };
        try {
            const safeRating = await setPhotoRatingValue(filePath, rating);
            return { success: true, rating: safeRating };
        } catch (err) {
            console.error("❌ Erreur set-photo-rating:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("set-photo-flag", async (event, filePath, flag) => {
        if (!filePath) return { success: false, error: "Chemin de fichier manquant" };
        try {
            const safeFlag = await setPhotoFlagValue(filePath, flag);
            return { success: true, flag: safeFlag };
        } catch (err) {
            console.error("❌ Erreur set-photo-flag:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("get-photos-status", async (event, filePaths) => {
        const result = {};
        if (!Array.isArray(filePaths) || filePaths.length === 0) return result;

        for (const p of filePaths) {
            result[p] = { rating: 0, flag: null };
        }

        try {
            const placeholders = filePaths.map(() => "?").join(",");
            const rows = await dbAll(
                `SELECT file_path, rating, flag FROM photo_settings WHERE file_path IN (${placeholders})`,
                filePaths
            );
            for (const row of rows) {
                result[row.file_path] = { rating: row.rating || 0, flag: row.flag || null };
            }
        } catch (err) {
            console.error("❌ Erreur get-photos-status:", err);
        }

        return result;
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
            let imageBuffer = Buffer.from(cleanBase64, "base64");

            let ext = ".jpg";
            if (exportConfig && exportConfig.format) {
                if (exportConfig.format === "image/png") ext = ".png";
                else if (exportConfig.format === "image/tiff") ext = ".tif";
                else if (exportConfig.format === "image/webp") ext = ".webp";
            }

            // 🎨 Conversion colorimétrique ICC réelle si un espace non-sRGB a été
            // choisi dans la modale d'export (voir services/colorManagement.js).
            // Repli silencieux sur sRGB (buffer inchangé) si le profil ICC demandé
            // est introuvable ; iccWarning remonté à l'appelant pour affichage.
            let iccWarning = null;
            if (exportConfig && exportConfig.colorSpace && exportConfig.colorSpace !== "srgb") {
                const iccResult = await convertBufferColorSpace(imageBuffer, exportConfig.colorSpace, ext, exportConfig.quality);
                imageBuffer = iccResult.buffer;
                if (!iccResult.converted && iccResult.reason === "icc-missing") {
                    iccWarning = `Profil ICC "${exportConfig.colorSpace}" introuvable : export réalisé en sRGB (voir assets/icc/README.txt).`;
                }
            }

            if (exportConfig && exportConfig.folder && (silent || exportConfig.folder)) {
                const destPath = path.join(exportConfig.folder, `${defaultName}${ext}`);
                fs.writeFileSync(destPath, imageBuffer);
                return { success: true, filePath: destPath, iccWarning };
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
            return { success: true, filePath, iccWarning };

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

            // 🎨 Impression : même chemin d'export final (exportFullResolution côté
            // renderer) que l'export JPEG, donc même conversion ICC réelle — mais
            // pas de sélecteur dédié dans le panneau Impression pour cette version :
            // on applique directement l'espace colorimétrique GLOBAL par défaut
            // (voir Fichier > Paramètres / services/colorManagement.js).
            try {
                const defaultColorSpace = studioPreferencesStore ? studioPreferencesStore.get("defaultColorSpace", "srgb") : "srgb";
                if (defaultColorSpace && defaultColorSpace !== "srgb") {
                    const iccResult = await convertBufferColorSpace(imageBuffer, defaultColorSpace, ".jpg", 0.95);
                    imageBuffer = iccResult.buffer;
                }
            } catch (iccErr) {
                console.warn("⚠️ Conversion ICC impression ignorée :", iccErr.message);
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
            return await addFolderToCatalog(folderData, (progress) => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send("catalog:scan-progress", progress);
                }
            });
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

    ipcMain.handle("catalog:get-stats", async () => {
        try {
            return await getCatalogStats();
        } catch (err) {
            console.error("❌ Erreur récupération statistiques catalogue:", err);
            return null;
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
    // 🛟 SAUVEGARDE / RESTAURATION MANUELLE DU CATALOGUE
    // ============================================================

    ipcMain.handle("catalog:export-backup", async () => {
        try {
            const pad = (n) => String(n).padStart(2, "0");
            const now = new Date();
            const defaultName = `nikon-catalog-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.db`;

            const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
                title: "Exporter une sauvegarde du catalogue",
                defaultPath: defaultName,
                filters: [{ name: "Base de données SQLite", extensions: ["db"] }]
            });

            if (canceled || !filePath) {
                return { success: false };
            }

            // VACUUM INTO exige que le fichier cible n'existe pas déjà.
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            await dbRun("VACUUM INTO ?", [filePath]);
            console.log("✅ Sauvegarde du catalogue exportée:", filePath);

            return { success: true, path: filePath };
        } catch (err) {
            console.error("❌ Erreur export sauvegarde catalogue:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("catalog:import-backup", async () => {
        try {
            const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
                title: "Restaurer une sauvegarde du catalogue",
                properties: ["openFile"],
                filters: [{ name: "Base de données SQLite", extensions: ["db"] }]
            });

            if (canceled || !filePaths.length) {
                return { success: false };
            }

            const importedPath = filePaths[0];

            // db.js et catalogService.js ouvrent chacun leur propre connexion vers
            // le même fichier catalog.db : il faut fermer les deux avant de toucher
            // au fichier, sinon le remplacement peut échouer ou laisser une connexion
            // pointer vers des données obsolètes.
            await closeDatabase();
            await closeCatalogDB();

            try {
                const backupsDir = path.join(path.dirname(CATALOG_DB_PATH), "backups");
                if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

                // Sauvegarde silencieuse de l'ancienne base avant écrasement, au cas
                // où l'utilisateur se serait trompé de fichier à importer.
                if (fs.existsSync(CATALOG_DB_PATH)) {
                    const preImportBackupPath = path.join(backupsDir, `pre-import-backup-${Date.now()}.db`);
                    fs.copyFileSync(CATALOG_DB_PATH, preImportBackupPath);
                    console.log("🛟 Ancienne base sauvegardée avant import:", preImportBackupPath);
                }

                fs.copyFileSync(importedPath, CATALOG_DB_PATH);
                console.log("✅ Base du catalogue remplacée par:", importedPath);
            } finally {
                // Toujours rouvrir les connexions, même en cas d'erreur pendant la
                // copie, pour ne jamais laisser l'application sans base utilisable.
                global.db = await initDatabase(CATALOG_DB_PATH);
                await ensurePhotoSettingsTable();
                await initCatalogDB();
            }

            if (mainWindow) {
                mainWindow.webContents.send("catalog:restored");
            }

            return { success: true };
        } catch (err) {
            console.error("❌ Erreur import sauvegarde catalogue:", err);
            return { success: false, error: err.message };
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

    // 🔹 formatFilter restreint le sélecteur à UN SEUL format ("ncp" ou "np3",
    // voir dropdown "Importer un profil" dans Gestionnaire de Profils) ; sans
    // argument, comportement inchangé (les deux extensions combinées).
    ipcMain.handle("loadNP3", async (event, formatFilter) => {
        let filters;
        if (formatFilter === "ncp") {
            filters = [{ name: "Picture Control Nikon NCP", extensions: ["ncp", "NCP"] }];
        } else if (formatFilter === "np3") {
            filters = [{ name: "Picture Control Nikon NP3", extensions: ["np3", "NP3"] }];
        } else {
            filters = [{ name: "Picture Control Nikon", extensions: ["np3", "ncp", "NP3", "NCP"] }];
        }
        filters.push({ name: "Tous les fichiers (*.*)", extensions: ["*"] });

        const result = await dialog.showOpenDialog({
            title: "Charger un Picture Control",
            properties: ["openFile"],
            filters
        });

        if (result.canceled || !result.filePaths.length) return null;

        try {
            const filePath = result.filePaths[0];
            const fileBuffer = fs.readFileSync(filePath);
            const fileName = path.basename(filePath);

            // 🔹 Les fichiers .np3/.ncp EXPORTÉS PAR CETTE APP (voir dialog:saveNP3 /
            // export-ncp) sont du JSON brut (JSON.stringify(pictureControl)) — on tente
            // de les reparser ici pour restituer un VRAI objet Picture Control
            // (isMonochrome, contrast, etc.) plutôt que de renvoyer uniquement les octets
            // bruts, que l'appelant n'avait jusqu'ici aucun moyen de décoder (c'était la
            // cause du bug diagnostiqué : un profil Monochrome importé perdait isMonochrome
            // et tous ses autres réglages, l'appelant retombant sur ce wrapper au lieu d'un
            // vrai Picture Control). Pour un vrai fichier NPC/NP3 binaire Nikon natif (pas
            // généré par cette app), le JSON.parse échoue : pictureControl reste null, et
            // le parsing binaire Nikon reste hors scope de ce correctif.
            let pictureControl = null;
            try {
                const parsed = JSON.parse(fileBuffer.toString("utf8"));
                if (parsed && typeof parsed === "object") pictureControl = parsed;
            } catch (parseErr) {
                pictureControl = null;
            }

            return {
                success: true,
                filePath: filePath,
                fileName: fileName,
                pictureControl,
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

    ipcMain.handle("toggle-fullscreen", () => {
        if (!mainWindow) return false;
        const isFullscreen = mainWindow.isFullScreen();
        mainWindow.setFullScreen(!isFullscreen);
        return !isFullscreen;
    });

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

    // ============================================================
    // 🖥️ PROGRAMMES EXTERNES ("Ouvrir avec...")
    // ============================================================

    ipcMain.handle("get-external-programs", async () => {
        return studioPreferencesStore ? studioPreferencesStore.get("externalPrograms", []) : [];
    });

    ipcMain.handle("save-external-programs", async (event, programs) => {
        if (!studioPreferencesStore) return { success: false, error: "Store indisponible" };
        studioPreferencesStore.set("externalPrograms", Array.isArray(programs) ? programs : []);
        return { success: true };
    });

    // ============================================================
    // 🖼️ ENCADREMENT (préférence globale, pas par photo — export ET impression)
    // ============================================================

    const DEFAULT_FRAME_SETTINGS = { enabled: false, color: "white", widthPercent: 5 };

    ipcMain.handle("get-frame-settings", async () => {
        return studioPreferencesStore ? studioPreferencesStore.get("frameSettings", DEFAULT_FRAME_SETTINGS) : DEFAULT_FRAME_SETTINGS;
    });

    ipcMain.handle("save-frame-settings", async (event, settings) => {
        if (!studioPreferencesStore) return { success: false, error: "Store indisponible" };
        studioPreferencesStore.set("frameSettings", {
            enabled: !!settings?.enabled,
            color: settings?.color === "black" ? "black" : "white",
            widthPercent: Math.max(0, Math.min(15, Number(settings?.widthPercent) || 0))
        });
        return { success: true };
    });

    // ============================================================
    // 🎨 ESPACE COLORIMÉTRIQUE PAR DÉFAUT (préférence globale — voir Fichier >
    // Paramètres et services/colorManagement.js pour la conversion ICC réelle)
    // ============================================================

    const VALID_COLOR_SPACES = ["srgb", "prophoto"];

    ipcMain.handle("get-default-color-space", async () => {
        return studioPreferencesStore ? studioPreferencesStore.get("defaultColorSpace", "srgb") : "srgb";
    });

    ipcMain.handle("save-default-color-space", async (event, value) => {
        if (!studioPreferencesStore) return { success: false, error: "Store indisponible" };
        const safeValue = VALID_COLOR_SPACES.includes(value) ? value : "srgb";
        studioPreferencesStore.set("defaultColorSpace", safeValue);
        return { success: true };
    });

    ipcMain.handle("check-icc-profiles", async () => {
        return checkIccProfilesAvailability();
    });

    // ============================================================
    // 🎞️ PRÉRÉGLAGES HALD-CLUT INTÉGRÉS (assets/hald-clut/bw, /color)
    // ============================================================

    ipcMain.handle("list-hald-clut-presets", async () => {
        const baseDir = path.join(__dirname, "assets", "hald-clut");

        const listCategory = (category) => {
            const categoryDir = path.join(baseDir, category);
            const results = [];
            if (!fs.existsSync(categoryDir)) return results;

            let entries;
            try {
                entries = fs.readdirSync(categoryDir, { withFileTypes: true });
            } catch (err) {
                console.error(`❌ Erreur lecture préréglages Hald-CLUT (${category}) :`, err);
                return results;
            }

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    // Sous-dossier de marque (Kodak, Ilford, ...)
                    const brand = entry.name;
                    const brandDir = path.join(categoryDir, brand);
                    let files = [];
                    try {
                        files = fs.readdirSync(brandDir).filter(f => f.toLowerCase().endsWith(".png"));
                    } catch (err) {
                        console.error(`❌ Erreur lecture dossier de marque ${brand} :`, err);
                        continue;
                    }
                    for (const file of files) {
                        results.push({
                            brand,
                            name: path.basename(file, path.extname(file)),
                            path: path.join(brandDir, file)
                        });
                    }
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
                    // PNG directement à la racine (bw/ ou color/), sans marque
                    results.push({
                        brand: null,
                        name: path.basename(entry.name, path.extname(entry.name)),
                        path: path.join(categoryDir, entry.name)
                    });
                }
            }

            results.sort((a, b) => {
                const brandCmp = (a.brand || "").localeCompare(b.brand || "");
                return brandCmp !== 0 ? brandCmp : a.name.localeCompare(b.name);
            });
            return results;
        };

        return {
            bw: listCategory("bw"),
            color: listCategory("color")
        };
    });

    // ============================================================
    // 🔍 CORRECTION D'OBJECTIF — base Lensfun (assets/lens-database/, CC BY-SA
    // 3.0, voir assets/lens-database/NOTICE) + profils importés manuellement
    // (userData/lens-profiles/)
    // ============================================================

    ipcMain.handle("list-lens-database-files", async () => {
        const dir = path.join(__dirname, "assets", "lens-database");
        try {
            return fs.readdirSync(dir)
                .filter(f => f.toLowerCase().endsWith(".xml"))
                .map(f => path.join(dir, f));
        } catch (err) {
            console.error("❌ Erreur lecture assets/lens-database :", err);
            return [];
        }
    });

    ipcMain.handle("list-imported-lens-profiles", async () => {
        const dir = path.join(app.getPath("userData"), "lens-profiles");
        try {
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir)
                .filter(f => f.toLowerCase().endsWith(".xml"))
                .map(f => path.join(dir, f));
        } catch (err) {
            console.error("❌ Erreur lecture des profils objectif importés :", err);
            return [];
        }
    });

    ipcMain.handle("import-lens-profile", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Importer un profil de correction d'objectif (XML Lensfun)",
            properties: ["openFile"],
            filters: [{ name: "Profil XML Lensfun", extensions: ["xml"] }]
        });

        if (result.canceled || !result.filePaths.length) return null;
        const srcPath = result.filePaths[0];

        try {
            const dir = path.join(app.getPath("userData"), "lens-profiles");
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const destName = path.basename(srcPath);
            const destPath = path.join(dir, destName);
            fs.copyFileSync(srcPath, destPath);

            return { success: true, path: destPath };
        } catch (err) {
            console.error("❌ Erreur import profil objectif :", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle("browse-executable", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Sélectionner le programme externe",
            properties: ["openFile"],
            filters: [{ name: "Exécutable Windows", extensions: ["exe"] }]
        });

        if (result.canceled || !result.filePaths.length) return null;
        return result.filePaths[0];
    });

    ipcMain.handle("browse-hald-clut", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Sélectionner un Hald-CLUT",
            properties: ["openFile"],
            filters: [{ name: "Image PNG", extensions: ["png"] }]
        });

        if (result.canceled || !result.filePaths.length) return null;
        return result.filePaths[0];
    });

    // 🔹 Convention de nommage : <nom>_<programme>.tif, puis <nom>-1_<programme>.tif,
    // <nom>-2_<programme>.tif... si le fichier existe déjà pour cette photo/ce programme.
    function generateExternalTiffPath(originalFilePath, programName) {
        const dir = path.dirname(originalFilePath);
        const baseName = path.basename(originalFilePath, path.extname(originalFilePath));
        const slug = (programName || "programme").toLowerCase().replace(/\s+/g, "");

        const firstCandidate = path.join(dir, `${baseName}_${slug}.tif`);
        if (!fs.existsSync(firstCandidate)) return firstCandidate;

        let n = 1;
        let candidate;
        do {
            candidate = path.join(dir, `${baseName}-${n}_${slug}.tif`);
            n++;
        } while (fs.existsSync(candidate));

        return candidate;
    }

    ipcMain.handle("catalog:add-single-file", async (event, filePath) => {
        try {
            return await addSingleFileToCatalog(filePath);
        } catch (err) {
            console.error("❌ Erreur catalog:add-single-file:", err);
            return null;
        }
    });

    ipcMain.handle("open-in-external-program", async (event, { imageDataUrl, originalFilePath, programExecPath, programName } = {}) => {
        try {
            if (!imageDataUrl || !originalFilePath || !programExecPath) {
                return { success: false, error: "Paramètres manquants" };
            }
            if (!fs.existsSync(programExecPath)) {
                return { success: false, error: `Programme introuvable : ${programExecPath}` };
            }

            const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
            const inputBuffer = Buffer.from(base64Data, "base64");

            const sharp = require("sharp");
            // Sans perte : compression LZW (pas de ré-encodage JPEG-dans-TIFF)
            const tiffBuffer = await sharp(inputBuffer, { limitInputPixels: false })
                .tiff({ compression: "lzw" })
                .toBuffer();

            const generatedPath = generateExternalTiffPath(originalFilePath, programName);
            fs.writeFileSync(generatedPath, tiffBuffer);

            const child = spawn(programExecPath, [generatedPath], { detached: true, stdio: "ignore" });
            child.unref();

            return { success: true, generatedPath };
        } catch (err) {
            console.error("❌ Erreur ouverture programme externe:", err);
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
// 🛟 SAUVEGARDE AUTOMATIQUE À LA FERMETURE (filet de sécurité)
// ============================================================

const MAX_AUTO_BACKUPS = 10;

async function performAutoBackup() {
    if (!global.db) return; // DB pas encore initialisée (fermeture très précoce)

    try {
        const backupsDir = path.join(path.dirname(CATALOG_DB_PATH), "backups");
        if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = path.join(backupsDir, `auto-backup-${timestamp}.db`);

        await dbRun("VACUUM INTO ?", [backupPath]);
        console.log("✅ Sauvegarde automatique créée:", backupPath);

        // Purge : ne garder que les MAX_AUTO_BACKUPS sauvegardes automatiques les plus récentes
        const autoBackups = fs.readdirSync(backupsDir)
            .filter((f) => f.startsWith("auto-backup-") && f.endsWith(".db"))
            .map((f) => {
                const fullPath = path.join(backupsDir, f);
                return { fullPath, mtime: fs.statSync(fullPath).mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime);

        for (const old of autoBackups.slice(MAX_AUTO_BACKUPS)) {
            try {
                fs.unlinkSync(old.fullPath);
            } catch (unlinkErr) {
                console.warn("⚠️ Erreur suppression ancienne sauvegarde auto:", unlinkErr.message);
            }
        }
    } catch (err) {
        console.error("❌ Erreur sauvegarde automatique à la fermeture:", err);
    }
}

// ============================================================
// 🔹 Gestion de la fermeture
// ============================================================

let readyToQuit = false;

app.on("before-quit", (event) => {
    if (readyToQuit) return;
    event.preventDefault();
    performAutoBackup().finally(() => {
        readyToQuit = true;
        app.quit();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

console.log("✅ main.js chargé avec persistance des réglages Picture Control");