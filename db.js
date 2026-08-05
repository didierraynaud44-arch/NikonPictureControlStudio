/*=========================================================
    Nikon Picture Control Studio - Catalogue : base SQLite
=========================================================*/

const sqlite3 = require("sqlite3").verbose();

let db = null;

/**
 * Initialise (ou récupère) la base SQLite du catalogue.
 * @param {string} dbFilePath - chemin ABSOLU du fichier catalog.db
 *        (à fournir par main.js, typiquement dans app.getPath('userData')
 *        pour rester accessible en écriture une fois l'app packagée en .exe)
 */
function initDatabase(dbFilePath) {
    if (db) return db; // déjà initialisée, ne pas rouvrir

    db = new sqlite3.Database(dbFilePath);

    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_path TEXT UNIQUE,
                folder_name TEXT
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT UNIQUE,
                file_name TEXT,
                file_size INTEGER,
                date_taken TEXT,
                camera_model TEXT,
                lens TEXT,
                iso INTEGER,
                aperture REAL,
                shutter_speed TEXT,
                picture_control TEXT,
                folder_path TEXT
            )
        `);
    });

    return db;
}

function getDb() {
    if (!db) {
        throw new Error("Base de données du catalogue non initialisée. Appeler initDatabase(dbFilePath) d'abord.");
    }
    return db;
}

/** Wrapper Promise autour de db.all (SELECT multi-lignes) */
function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        getDb().all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/** Wrapper Promise autour de db.run (INSERT/UPDATE/DELETE) */
function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        getDb().run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this); // this.lastID / this.changes disponibles si besoin
        });
    });
}

module.exports = { initDatabase, getDb, dbAll, dbRun };
