const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { startServer, closeDatabase } = require('../server');

let server;

async function openWindow() {
  try {
    const started = await startServer();
    server = started.server;
    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1080,
      minHeight: 700,
      backgroundColor: '#f7f8fc',
      title: 'Atlas Finance',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== started.url && url !== `${started.url}/`) event.preventDefault();
    });
    await window.loadURL(started.url);
  } catch (error) {
    dialog.showErrorBox('Unable to start Atlas Finance', `${error.message}\n\nCheck that MySQL is running and your .env settings are correct.`);
    app.quit();
  }
}

app.whenReady().then(openWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (server) server.close();
  closeDatabase().catch(console.error);
});
