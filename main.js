
const pictureControlEngine = require("./services/pictureControlEngine");
const {
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    dialog
} = require("electron");

const path = require("path");

const { readNEF } = require("./engine/nefReader");
const { getPreview } = require("./engine/nefPreview");
const { readPictureControl } = require("./engine/pictureControl");

const { loadNP3 } = require("./services/np3Manager");

let mainWindow = null;


/* =======================================================
   Fenêtre principale
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
   Menu
======================================================= */

function createAppMenu() {

    const menu = Menu.buildFromTemplate([

        {

            label: "Fichier",

            submenu: [

                {

                    label: "Ouvrir un NEF",

                    click: () => {

                        mainWindow.webContents.send("menu-open-nef");

                    }

                },

                {

                    label: "Charger un Picture Control (.NP3)",

                    click: () => {

                        mainWindow.webContents.send("menu-open-np3");

                    }

                },

                {

                    type: "separator"

                },

                {

                    label: "Quitter",

                    click: () => app.quit()

                }

            ]

        }

    ]);

    Menu.setApplicationMenu(menu);

}


/* =======================================================
   Ouvrir un NEF
======================================================= */

ipcMain.handle("open-nef", async () => {

    const result = await dialog.showOpenDialog({

        title: "Choisir un fichier Nikon NEF",

        properties: ["openFile"],

        filters: [

            {

                name: "Nikon RAW",

                extensions: ["nef"]

            }

        ]

    });

    if (result.canceled)
        return null;

    const filePath = result.filePaths[0];

    const info = await readNEF(filePath);

    info.preview = await getPreview(filePath);

 const pictureControl = await readPictureControl(filePath);

pictureControlEngine.load(pictureControl);

info.pictureControl = pictureControlEngine.get();

return info;

});


/* =======================================================
   Charger un NP3
======================================================= */

ipcMain.handle("loadNP3", async () => {

    const result = await dialog.showOpenDialog({

        title: "Charger un Picture Control",

        properties: ["openFile"],

        filters: [
            {
                name: "Picture Control Nikon",
                extensions: ["np3"]
            }
        ]

    });

    if (result.canceled)
        return null;

    const pc = await loadNP3(result.filePaths[0]);

    pictureControlEngine.load(pc);

    return pictureControlEngine.get();

});

/* =======================================================
   Electron
======================================================= */

app.whenReady().then(() => {

    createMainWindow();

    createAppMenu();

});


app.on("window-all-closed", () => {

    if (process.platform !== "darwin")

        app.quit();

});


app.on("activate", () => {

    if (BrowserWindow.getAllWindows().length === 0)

        createMainWindow();

});

/*=========================================================
    Picture Control Engine
=========================================================*/

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