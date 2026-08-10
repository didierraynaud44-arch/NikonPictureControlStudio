/*=========================================================
    Nikon Picture Control Studio - Catalog Service (SQLite)
    Version complète avec indexation EXIF
=========================================================*/
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { app } = require("electron");
const exifr = require("exifr");
const sharp = require("sharp");

// ============================================================
// CONFIGURATION
// ============================================================

const DB_PATH = path.join(app.getPath("userData"), "catalog.db");
const CACHE_DIR = path.join(app.getPath("userData"), "thumbnails_cache");

// Créer le dossier de cache si nécessaire
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

let db = null;

// ============================================================
// INITIALISATION DE LA BASE DE DONNÉES
// ============================================================

function initCatalogDB() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error("❌ Erreur d'ouverture SQLite :", err);
                return reject(err);
            }

            console.log("✅ Base de données catalogue ouverte");

            db.serialize(() => {
                // Table des dossiers
                db.run(`
                    CREATE TABLE IF NOT EXISTS catalog_folders (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        folder_path TEXT UNIQUE NOT NULL,
                        folder_name TEXT NOT NULL,
                        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Table des photos avec TOUS les champs EXIF
                db.run(`
                    CREATE TABLE IF NOT EXISTS catalog_photos (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        folder_path TEXT NOT NULL,
                        file_path TEXT UNIQUE NOT NULL,
                        file_name TEXT NOT NULL,
                        thumb_path TEXT,
                        picture_control_json TEXT,
                        transform_json TEXT,
                        
                        -- EXIF METADATA
                        make TEXT,
                        model TEXT,
                        lens TEXT,
                        focal_length REAL,
                        aperture REAL,
                        shutter_speed TEXT,
                        iso INTEGER,
                        exposure_compensation REAL,
                        white_balance TEXT,
                        color_temperature INTEGER,
                        date_time_original TEXT,
                        date_time_digitized TEXT,
                        gps_latitude REAL,
                        gps_longitude REAL,
                        gps_altitude REAL,
                        orientation INTEGER,
                        flash BOOLEAN,
                        exposure_mode TEXT,
                        metering_mode TEXT,
                        focus_mode TEXT,
                        image_width INTEGER,
                        image_height INTEGER,
                        color_space TEXT,
                        keywords TEXT,
                        rating INTEGER,
                        label TEXT,
                        raw_exif TEXT,
                        
                        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        console.error("❌ Erreur création table photos:", err);
                        return reject(err);
                    }

                    // Créer les index
                    db.run(`CREATE INDEX IF NOT EXISTS idx_photos_folder_path ON catalog_photos(folder_path)`);
                    db.run(`CREATE INDEX IF NOT EXISTS idx_photos_model ON catalog_photos(model)`);
                    db.run(`CREATE INDEX IF NOT EXISTS idx_photos_iso ON catalog_photos(iso)`);
                    db.run(`CREATE INDEX IF NOT EXISTS idx_photos_date ON catalog_photos(date_time_original)`);
                    db.run(`CREATE INDEX IF NOT EXISTS idx_photos_lens ON catalog_photos(lens)`);
                    db.run(`CREATE INDEX IF NOT EXISTS idx_photos_rating ON catalog_photos(rating)`);
                    
                    console.log("✅ Tables et index créés avec succès");
                    resolve(db);
                });
            });
        });
    });
}

// ============================================================
// FONCTIONS UTILITAIRES SQL
// ============================================================

function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function allAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// ============================================================
// EXTRACTION DES EXIF
// ============================================================

function formatShutterSpeed(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value >= 1) return `${Math.round(value)}s`;
    return `1/${Math.round(1/value)}s`;
}

async function extractExifData(filePath) {
    try {
        const exif = await exifr.parse(filePath);
        if (!exif) return {};
        
        return {
            make: exif.Make || null,
            model: exif.Model || null,
            lens: exif.LensModel || exif.Lens || null,
            focal_length: exif.FocalLength ? parseFloat(exif.FocalLength) : null,
            aperture: exif.FNumber ? parseFloat(exif.FNumber) : null,
            shutter_speed: exif.ExposureTime ? formatShutterSpeed(exif.ExposureTime) : null,
            iso: exif.ISO || null,
            exposure_compensation: exif.ExposureCompensation || null,
            white_balance: exif.WhiteBalanceName || exif.WhiteBalance || null,
            color_temperature: exif.ColorTemperature || null,
            date_time_original: exif.DateTimeOriginal || exif.CreateDate || null,
            date_time_digitized: exif.DateTimeDigitized || exif.ModifyDate || null,
            gps_latitude: exif.latitude || null,
            gps_longitude: exif.longitude || null,
            gps_altitude: exif.altitude || null,
            orientation: exif.Orientation || 1,
            flash: exif.Flash ? true : false,
            exposure_mode: exif.ExposureMode || null,
            metering_mode: exif.MeteringMode || null,
            focus_mode: exif.FocusMode || null,
            image_width: exif.ImageWidth || null,
            image_height: exif.ImageHeight || null,
            color_space: exif.ColorSpaceName || null,
            keywords: exif.Keywords ? JSON.stringify(exif.Keywords) : null,
            rating: exif.Rating || null,
            label: exif.Label || null,
            raw_exif: JSON.stringify(exif)
        };
    } catch (err) {
        console.warn(`⚠️ Erreur extraction EXIF pour ${path.basename(filePath)}:`, err.message);
        return {};
    }
}

// ============================================================
// OPÉRATIONS SUR LE CATALOGUE
// ============================================================

/**
 * Ajoute un dossier et ses photos au catalogue avec EXIF
 */
async function addFolderToCatalog(folderData) {
    if (!folderData || !folderData.path) return null;

    try {
        // Ajouter le dossier
        await runAsync(
            `INSERT OR IGNORE INTO catalog_folders (folder_path, folder_name) VALUES (?, ?)`,
            [folderData.path, folderData.name]
        );

        console.log(`📂 Indexation du dossier: ${folderData.name}`);

        let indexedCount = 0;
        let totalFiles = 0;

        const processNode = async (node) => {
            if (node.files && node.files.length > 0) {
                for (const file of node.files) {
                    totalFiles++;
                    try {
                        // Extraire les EXIF
                        const exifData = await extractExifData(file.path);
                        
                        // Vérifier si la photo existe déjà
                        const existing = await getPhotoByPath(file.path);
                        
                        // Conserver les réglages existants
                        let pictureControlJson = existing?.picture_control_json || null;
                        let transformJson = existing?.transform_json || null;

                        // Requête avec TOUS les champs EXIF
                        const query = `
    INSERT OR REPLACE INTO catalog_photos (
        folder_path, file_path, file_name, thumb_path,
        picture_control_json, transform_json,
        make, model, lens, focal_length, aperture,
        shutter_speed, iso, exposure_compensation,
        white_balance, color_temperature,
        date_time_original, date_time_digitized,
        gps_latitude, gps_longitude, gps_altitude,
        orientation, flash, exposure_mode,
        metering_mode, focus_mode,
        image_width, image_height, color_space,
        keywords, rating, label, raw_exif,
        updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

                        const params = [
                            folderData.path,
                            file.path,
                            file.name,
                            null, // thumb_path
                            pictureControlJson,
                            transformJson,
                            exifData.make || null,
                            exifData.model || null,
                            exifData.lens || null,
                            exifData.focal_length || null,
                            exifData.aperture || null,
                            exifData.shutter_speed || null,
                            exifData.iso || null,
                            exifData.exposure_compensation || null,
                            exifData.white_balance || null,
                            exifData.color_temperature || null,
                            exifData.date_time_original || null,
                            exifData.date_time_digitized || null,
                            exifData.gps_latitude || null,
                            exifData.gps_longitude || null,
                            exifData.gps_altitude || null,
                            exifData.orientation || 1,
                            exifData.flash ? 1 : 0,
                            exifData.exposure_mode || null,
                            exifData.metering_mode || null,
                            exifData.focus_mode || null,
                            exifData.image_width || null,
                            exifData.image_height || null,
                            exifData.color_space || null,
                            exifData.keywords || null,
                            exifData.rating || null,
                            exifData.label || null,
                            exifData.raw_exif || null
                        ];

                        await runAsync(query, params);
                        indexedCount++;

                        if (indexedCount % 10 === 0) {
                            console.log(`   📸 ${indexedCount} photos indexées...`);
                        }
                    } catch (err) {
                        console.error(`❌ Erreur indexation ${file.name}:`, err.message);
                    }
                }
            }

            if (node.children && node.children.length > 0) {
                for (const child of node.children) {
                    await processNode(child);
                }
            }
        };

        await processNode(folderData);

        console.log(`✅ Indexation terminée: ${indexedCount}/${totalFiles} photos avec EXIF`);
        return await getFullCatalog();
    } catch (err) {
        console.error("❌ Erreur ajout catalogue :", err);
        throw err;
    }
}

/**
 * Récupère tous les dossiers du catalogue
 */
async function getFolders() {
    try {
        return await allAsync(`SELECT * FROM catalog_folders ORDER BY folder_name ASC`);
    } catch (err) {
        console.error("❌ Erreur getFolders:", err);
        return [];
    }
}

/**
 * Récupère les photos d'un dossier (ou toutes) avec TOUS les EXIF
 */
async function getPhotos(folderPath = null) {
    try {
        let query = `
            SELECT 
                id, folder_path, file_path, file_name, thumb_path,
                picture_control_json, transform_json,
                make, model, lens, focal_length, aperture,
                shutter_speed, iso, exposure_compensation,
                white_balance, color_temperature,
                date_time_original, date_time_digitized,
                gps_latitude, gps_longitude, gps_altitude,
                orientation, flash, exposure_mode,
                metering_mode, focus_mode,
                image_width, image_height, color_space,
                keywords, rating, label,
                raw_exif
            FROM catalog_photos
        `;
        const params = [];
        
        if (folderPath) {
            query += ' WHERE folder_path = ?';
            params.push(folderPath);
        }
        
        query += ' ORDER BY date_time_original DESC, file_name ASC';
        
        const rows = await allAsync(query, params);
        
        // Convertir les données pour le renderer
        return rows.map(row => ({
            ...row,
            picture_control: row.picture_control_json ? JSON.parse(row.picture_control_json) : null,
            transform: row.transform_json ? JSON.parse(row.transform_json) : null,
            iso: row.iso ? parseInt(row.iso) : null,
            aperture: row.aperture ? parseFloat(row.aperture) : null,
            focal_length: row.focal_length ? parseFloat(row.focal_length) : null,
            thumbBase64: row.thumb_path ? `file://${row.thumb_path.replace(/\\/g, '/')}` : null
        }));
    } catch (err) {
        console.error("❌ Erreur getPhotos:", err);
        return [];
    }
}

/**
 * Récupère une photo spécifique par son chemin avec TOUS les EXIF
 */
async function getPhotoByPath(filePath) {
    try {
        const query = `
            SELECT 
                id, folder_path, file_path, file_name, thumb_path,
                picture_control_json, transform_json,
                make, model, lens, focal_length, aperture,
                shutter_speed, iso, exposure_compensation,
                white_balance, color_temperature,
                date_time_original, date_time_digitized,
                gps_latitude, gps_longitude, gps_altitude,
                orientation, flash, exposure_mode,
                metering_mode, focus_mode,
                image_width, image_height, color_space,
                keywords, rating, label,
                raw_exif
            FROM catalog_photos
            WHERE file_path = ?
        `;
        
        const row = await getAsync(query, [filePath]);
        
        if (!row) return null;
        
        return {
            ...row,
            picture_control: row.picture_control_json ? JSON.parse(row.picture_control_json) : null,
            transform: row.transform_json ? JSON.parse(row.transform_json) : null,
            iso: row.iso ? parseInt(row.iso) : null,
            aperture: row.aperture ? parseFloat(row.aperture) : null,
            focal_length: row.focal_length ? parseFloat(row.focal_length) : null,
            thumbBase64: row.thumb_path ? `file://${row.thumb_path.replace(/\\/g, '/')}` : null
        };
    } catch (err) {
        console.error("❌ Erreur getPhotoByPath:", err);
        return null;
    }
}

/**
 * Recherche avancée dans le catalogue
 */
async function searchPhotos(searchTerm) {
    try {
        const query = `
            SELECT 
                file_path, file_name, thumb_path,
                make, model, lens, focal_length, aperture,
                shutter_speed, iso, date_time_original,
                rating, label, keywords
            FROM catalog_photos
            WHERE 
                file_name LIKE ? OR
                make LIKE ? OR
                model LIKE ? OR
                lens LIKE ? OR
                keywords LIKE ? OR
                label LIKE ?
            ORDER BY date_time_original DESC
        `;
        const pattern = `%${searchTerm}%`;
        return await allAsync(query, [
            pattern, pattern, pattern,
            pattern, pattern, pattern
        ]);
    } catch (err) {
        console.error("❌ Erreur searchPhotos:", err);
        return [];
    }
}

/**
 * Récupère les statistiques du catalogue
 */
async function getCatalogStats() {
    try {
        return await getAsync(`
            SELECT 
                COUNT(*) as totalPhotos,
                COUNT(DISTINCT folder_path) as totalFolders,
                COUNT(DISTINCT model) as totalModels,
                COUNT(DISTINCT lens) as totalLenses,
                MIN(iso) as minIso,
                MAX(iso) as maxIso,
                MIN(date_time_original) as oldestPhoto,
                MAX(date_time_original) as newestPhoto
            FROM catalog_photos
        `);
    } catch (err) {
        console.error("❌ Erreur getCatalogStats:", err);
        return null;
    }
}

/**
 * Reconstruit l'arborescence complète
 */
function buildFolderHierarchy(flatPhotos, rootPath, rootName) {
    const rootNode = {
        name: rootName,
        path: rootPath,
        files: [],
        children: []
    };

    const folderMap = new Map();
    folderMap.set(rootPath, rootNode);

    flatPhotos.forEach(p => {
        const filePath = p.file_path;
        const dirPath = path.dirname(filePath);

        if (dirPath === rootPath) {
            rootNode.files.push({
                id: p.id,
                name: p.file_name,
                path: p.file_path,
                thumbPath: p.thumb_path,
                make: p.make,
                model: p.model,
                lens: p.lens,
                iso: p.iso,
                aperture: p.aperture,
                focal_length: p.focal_length,
                shutter_speed: p.shutter_speed,
                date: p.date_time_original,
                rating: p.rating,
                label: p.label,
                pictureControl: p.picture_control_json ? JSON.parse(p.picture_control_json) : null
            });
            return;
        }

        let currentParentPath = rootPath;
        const relativeSegments = path.relative(rootPath, dirPath).split(path.sep);

        relativeSegments.forEach(segment => {
            const currentPath = path.join(currentParentPath, segment);

            if (!folderMap.has(currentPath)) {
                const newFolder = {
                    name: segment,
                    path: currentPath,
                    files: [],
                    children: []
                };
                folderMap.set(currentPath, newFolder);

                const parentFolder = folderMap.get(currentParentPath);
                if (parentFolder) {
                    parentFolder.children.push(newFolder);
                }
            }
            currentParentPath = currentPath;
        });

        const targetFolder = folderMap.get(dirPath);
        if (targetFolder) {
            targetFolder.files.push({
                id: p.id,
                name: p.file_name,
                path: p.file_path,
                thumbPath: p.thumb_path,
                make: p.make,
                model: p.model,
                lens: p.lens,
                iso: p.iso,
                aperture: p.aperture,
                focal_length: p.focal_length,
                shutter_speed: p.shutter_speed,
                date: p.date_time_original,
                rating: p.rating,
                label: p.label,
                pictureControl: p.picture_control_json ? JSON.parse(p.picture_control_json) : null
            });
        }
    });

    return rootNode;
}

/**
 * Récupère tout le catalogue avec arborescence
 */
async function getFullCatalog() {
    try {
        const folders = await getFolders();
        const photos = await allAsync(`
            SELECT 
                id, folder_path, file_path, file_name, thumb_path,
                make, model, lens, iso, aperture, focal_length,
                shutter_speed, date_time_original,
                rating, label, keywords,
                picture_control_json, transform_json
            FROM catalog_photos
            ORDER BY file_name ASC
        `);

        return folders.map(folder => {
            const folderPhotos = photos.filter(p => p.folder_path === folder.folder_path);
            return buildFolderHierarchy(folderPhotos, folder.folder_path, folder.folder_name);
        });
    } catch (err) {
        console.error("❌ Erreur getFullCatalog:", err);
        return [];
    }
}

/**
 * Supprime un dossier du catalogue
 */
async function removeFolderFromCatalog(folderPath) {
    try {
        await runAsync(`DELETE FROM catalog_photos WHERE folder_path = ?`, [folderPath]);
        await runAsync(`DELETE FROM catalog_folders WHERE folder_path = ?`, [folderPath]);
        return await getFullCatalog();
    } catch (err) {
        console.error("❌ Erreur removeFolderFromCatalog:", err);
        throw err;
    }
}

/**
 * Sauvegarde les réglages Picture Control d'une photo
 */
async function savePhotoSettings(filePath, pictureControlData) {
    try {
        await runAsync(
            `UPDATE catalog_photos SET picture_control_json = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?`,
            [JSON.stringify(pictureControlData), filePath]
        );
        return true;
    } catch (err) {
        console.error("❌ Erreur savePhotoSettings:", err);
        return false;
    }
}

/**
 * Récupère les réglages Picture Control d'une photo
 */
async function getPhotoSettings(filePath) {
    try {
        const row = await getAsync(
            `SELECT picture_control_json, transform_json FROM catalog_photos WHERE file_path = ?`,
            [filePath]
        );

        if (!row) return null;

        const result = {};
        if (row.picture_control_json) {
            Object.assign(result, JSON.parse(row.picture_control_json));
        }
        if (row.transform_json) {
            result.transform = JSON.parse(row.transform_json);
        }
        return result;
    } catch (err) {
        console.error("❌ Erreur getPhotoSettings:", err);
        return null;
    }
}

/**
 * Sauvegarde la transformation (rotation/miroir) d'une photo
 */
async function saveTransform(filePath, transformData) {
    try {
        await runAsync(
            `UPDATE catalog_photos SET transform_json = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?`,
            [JSON.stringify(transformData), filePath]
        );
        return true;
    } catch (err) {
        console.error("❌ Erreur saveTransform:", err);
        return false;
    }
}

// ============================================================
// EXPORTATION
// ============================================================

module.exports = {
    initCatalogDB,
    addFolderToCatalog,
    getFolders,
    getPhotos,
    getPhotoByPath,
    searchPhotos,
    getCatalogStats,
    getFullCatalog,
    removeFolderFromCatalog,
    savePhotoSettings,
    getPhotoSettings,
    saveTransform,
    extractExifData
};