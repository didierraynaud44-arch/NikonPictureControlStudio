
const ExifReader = require("exifreader");
const fs = require("fs");
const { 
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    dialog
} = require("electron");
const path = require('path');
const { readNEF } = require("./engine/nefReader");
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

    frame: true,
    autoHideMenuBar: false,

    webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false
    }

});
    mainWindow.loadFile("renderer/index.html");

    // Décommenter pendant le développement
    mainWindow.webContents.openDevTools();

}
function createAppMenu() {

    const menuTemplate = [
        {
            label: "Fichier",
            submenu: [
                {
                    label: "Test menu",
                    click: () => {
                        console.log("MENU OK");
                    }
                },
                {
                    type: "separator"
                },
                {
                    label: "Quitter",
                    click: () => {
                        app.quit();
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);

Menu.setApplicationMenu(null);

    console.log("MENU INSTALLE :", Menu.getApplicationMenu() !== null);
}

ipcMain.handle("open-nef", async () => {

    const result = await dialog.showOpenDialog({

        title: "Choisir un fichier Nikon NEF",

        properties: [
            "openFile"
        ],

        filters: [
            {
                name: "Images Nikon RAW",
                extensions: [
                    "nef"
                ]
            }
        ]

    });


    if (result.canceled) {

        return null;

    }


    const filePath = result.filePaths[0];

    const info = await readNEF(filePath);

    return info;

});


/**
 * Au démarrage d'Electron
 */
app.whenReady().then(() => {

    createAppMenu();

    createMainWindow();

    mainWindow.show();
    mainWindow.focus();

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