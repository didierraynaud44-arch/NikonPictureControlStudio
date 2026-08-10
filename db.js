/*=========================================================
    Nikon Picture Control Studio - Database Manager
=========================================================*/
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { app } = require("electron");

// 🔹 Stocker la base dans global pour y accéder partout
global.db = null;

function initDatabase(dbFilePath) {
    if (global.db) return global.db; // Évite les doublons

    return new Promise((resolve, reject) => {
        console.log("📁 Initialisation de la base:", dbFilePath);
        global.db = new sqlite3.Database(dbFilePath, (err) => {
            if (err) {
                console.error("❌ Erreur ouverture DB:", err);
                reject(err);
            } else {
                console.log("✅ Base de données ouverte.");
                resolve(global.db);
            }
        });
    });
}

function getDb() {
    if (!global.db) {
        throw new Error("Base de données non initialisée. Appeler initDatabase() d'abord.");
    }
    return global.db;
}

function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        getDb().all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        getDb().run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// db.js
module.exports = {
    initDatabase,
    getDb,
    dbAll,
    dbRun
};