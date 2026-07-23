const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;

/**
 * Création de la fenêtre principale
 */
function createMainWindow() {

    mainWindow = new BrowserWindow({

        width: 1600,
        height: 950,

        minWidth: 1200,
        minHeight: 800,

        title: "Nikon Picture Control Studio",

        backgroundColor: "#202124",

        autoHideMenuBar: false,

        webPreferences: {

            preload: path.join(__dirname, "preload.js"),

            contextIsolation: true,

            nodeIntegration: false

        }

    });

    mainWindow.loadFile("renderer/index.html");

    // Décommenter pendant le développement
    // mainWindow.webContents.openDevTools();

}


/**
 * Au démarrage d'Electron
 */
app.whenReady().then(() => {

    createMainWindow();

});


/**
 * Fermeture
 */
app.on("window-all-closed", () => {

    if (process.platform !== "darwin")
        app.quit();

});


/**
 * macOS
 */
app.on("activate", () => {

    if (BrowserWindow.getAllWindows().length === 0)
        createMainWindow();

});