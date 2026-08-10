/*=========================================================
    Nikon Picture Control Studio - Catalog Service (SQLite)
=========================================================*/

const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { app } = require("electron");

let db = null;
const cacheDir = path.join(app.getPath("userData"), "thumbnails_cache");

if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

function initCatalogDB() {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(app.getPath("userData"), "catalog.db");
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error("❌ Erreur d'ouverture SQLite :", err);
                return reject(err);
            }

            db.serialize(() => {
                // 1. Table des dossiers
                db.run(`
                    CREATE TABLE IF NOT EXISTS catalog_folders (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        folder_path TEXT UNIQUE NOT NULL,
                        folder_name TEXT NOT NULL,
                        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // 2. Table des photos (avec toutes les colonnes nécessaires)
                db.run(`
                    CREATE TABLE IF NOT EXISTS catalog_photos (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        folder_path TEXT NOT NULL,
                        file_path TEXT UNIQUE NOT NULL,
                        file_name TEXT NOT NULL,
                        thumb_path TEXT,
                        picture_control_json TEXT,
                        transform_json TEXT,  // 🔹 Ajoutée ici
                        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (initErr) => {
                    if (initErr) {
                        reject(initErr);
                    } else {
                        // 3. Vérifier si la colonne transform_json existe, sinon l'ajouter
                        db.get(`
                            SELECT * FROM pragma_table_info('catalog_photos')
                            WHERE name = 'transform_json'
                        `, (err, row) => {
                            if (err) {
                                console.error("❌ Erreur vérification colonne:", err);
                                reject(err);
                            } else if (!row) {
                                // 🔹 Ajouter la colonne si elle n'existe pas
                                db.run(`
                                    ALTER TABLE catalog_photos
                                    ADD COLUMN transform_json TEXT
                                `, (alterErr) => {
                                    if (alterErr) {
                                        console.error("❌ Erreur ajout colonne transform_json:", alterErr);
                                        reject(alterErr);
                                    } else {
                                        console.log("✅ Colonne transform_json ajoutée.");
                                        resolve(db);
                                    }
                                });
                            } else {
                                console.log("✅ Base de données et colonnes initialisées.");
                                resolve(db);
                            }
                        });
                    }
                });
            });
        });
    });
}
function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
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

/**
 * Enregistre un dossier et ses photos dans SQLite
 */
async function addFolderToCatalog(folderData) {
    if (!folderData || !folderData.path) return null;

    try {
        await runAsync(
            `INSERT OR IGNORE INTO catalog_folders (folder_path, folder_name) VALUES (?, ?)`,
            [folderData.path, folderData.name]
        );

        const extractAndSave = async (node) => {
            if (node.files && node.files.length > 0) {
                for (const file of node.files) {
                    await runAsync(
                        `INSERT OR IGNORE INTO catalog_photos (folder_path, file_path, file_name) VALUES (?, ?, ?)`,
                        [folderData.path, file.path, file.name]
                    );
                }
            }
            if (node.children && node.children.length > 0) {
                for (const child of node.children) {
                    await extractAndSave(child);
                }
            }
        };

        await extractAndSave(folderData);
        return await getFullCatalog();
    } catch (err) {
        console.error("❌ Erreur ajout catalogue SQLite :", err);
        throw err;
    }
}

/**
 * Récupère tous les dossiers et photos indexés
 */
/**
 * Reconstruit la hiérarchie récursive à partir des chemins d'accès
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

        // Si le fichier est directement à la racine
        if (dirPath === rootPath) {
            rootNode.files.push({
                id: p.id,
                name: p.file_name,
                path: p.file_path,
                thumbPath: p.thumb_path,
                pictureControl: p.picture_control_json ? JSON.parse(p.picture_control_json) : null
            });
            return;
        }

        // Gestion des sous-dossiers
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

        // Ajout du fichier à son sous-dossier respectif
        const targetFolder = folderMap.get(dirPath);
        if (targetFolder) {
            targetFolder.files.push({
                id: p.id,
                name: p.file_name,
                path: p.file_path,
                thumbPath: p.thumb_path,
                pictureControl: p.picture_control_json ? JSON.parse(p.picture_control_json) : null
            });
        }
    });

    return rootNode;
}

/**
 * Récupère tous les dossiers et reconstruit leur arborescence
 */
async function getFullCatalog() {
    try {
        const folders = await allAsync(`SELECT * FROM catalog_folders ORDER BY folder_name ASC`);
        const photos = await allAsync(`SELECT * FROM catalog_photos ORDER BY file_name ASC`);

        return folders.map(folder => {
            const folderPhotos = photos.filter(p => p.folder_path === folder.folder_path);
            return buildFolderHierarchy(folderPhotos, folder.folder_path, folder.folder_name);
        });
    } catch (err) {
        console.error("❌ Erreur lecture catalogue SQLite :", err);
        return [];
    }
}

/**
 * Supprime un dossier et ses photos associées du catalogue
 */
async function removeFolderFromCatalog(folderPath) {
    try {
        await runAsync(`DELETE FROM catalog_photos WHERE folder_path = ?`, [folderPath]);
        await runAsync(`DELETE FROM catalog_folders WHERE folder_path = ?`, [folderPath]);
        return await getFullCatalog();
    } catch (err) {
        console.error("❌ Erreur suppression catalogue :", err);
        throw err;
    }
}

/**
 * Sauvegarde les réglages Picture Control d'une photo
 */
async function savePhotoSettings(filePath, pictureControlData) {
    try {
        await runAsync(
            `UPDATE catalog_photos SET picture_control_json = ? WHERE file_path = ?`,
            [JSON.stringify(pictureControlData), filePath]
        );
        return true;
    } catch (err) {
        console.error("❌ Erreur sauvegarde réglages photo :", err);
        return false;
    }
}

module.exports = {
    
    initCatalogDB,
    addFolderToCatalog,
    getFullCatalog,
    removeFolderFromCatalog,
    savePhotoSettings,
   
};
module.exports = {
    initCatalogDB,
    addFolderToCatalog,
    getFullCatalog,
    removeFolderFromCatalog,
    savePhotoSettings,
    getPhotoSettings  // 🔹 Ajoutez cette ligne
};