const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {

    const win = new BrowserWindow({

        width: 1700,
        height: 1000,

        webPreferences: {

            preload: path.join(__dirname, 'preload.js')

        }

    });

    win.loadFile('renderer/index.html');

}

app.whenReady().then(createWindow);