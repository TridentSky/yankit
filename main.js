const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const Downloader = require('./downloader');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

app.disableHardwareAcceleration();

const CACHE_DIR = IS_WIN
    ? path.join(os.homedir(), 'AppData', 'Local', 'Yankit')
    : IS_MAC
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Yankit')
        : path.join(os.homedir(), '.config', 'yankit');

app.setPath('userData', CACHE_DIR);
app.setPath('cache', path.join(CACHE_DIR, 'Cache'));
app.setPath('temp', path.join(CACHE_DIR, 'Temp'));

let mainWindow;
let dl;

function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function checkForUpdate() {
    return new Promise(resolve => {
        https.get({
            hostname: 'api.github.com',
            path: '/repos/TridentSky/yankit/releases/latest',
            headers: { 'User-Agent': 'Yankit' },
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) { resolve(null); return; }
                    const r = JSON.parse(data);
                    const latest = (r.tag_name || '').replace(/^v/, '');
                    const lp = latest.split('.').map(Number);
                    const cp = PKG.version.split('.').map(Number);
                    let newer = false;
                    for (let i = 0; i < 3; i++) {
                        if ((lp[i] || 0) > (cp[i] || 0)) { newer = true; break; }
                        if ((lp[i] || 0) < (cp[i] || 0)) break;
                    }
                    resolve(newer ? { version: latest, url: r.html_url } : null);
                } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 920, height: 720,
        minWidth: 650, minHeight: 520,
        backgroundColor: '#0D0D14',
        title: 'Yankit Downloader',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.setMenu(null);
    mainWindow.loadFile(path.join(__dirname, 'static', 'index.html'));
    mainWindow.once('ready-to-show', () => mainWindow.show());

    mainWindow.on('close', (e) => {
        if (dl.hasActive()) {
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question',
                buttons: ['Cancel', 'Close Yankit'],
                defaultId: 0, cancelId: 0,
                title: 'Active Downloads',
                message: 'You have active downloads.',
                detail: 'Closing will cancel all downloads and delete incomplete files.',
            });
            if (choice === 0) { e.preventDefault(); return; }
        }
        dl.cleanupAll();
    });
}

app.whenReady().then(() => {
    let binDir = path.join(__dirname, 'bin');
    let settingsPath = path.join(__dirname, 'settings.json');

    if (app.isPackaged) {
        binDir = path.join(process.resourcesPath, 'bin');
        settingsPath = path.join(path.dirname(app.getPath('exe')), 'settings.json');
    }

    dl = new Downloader({
        binDir, settingsPath,
        onUpdate: (data) => sendToRenderer('download-update', data),
    });

    if (!dl.init()) {
        dialog.showErrorBox('yt-dlp Not Found',
            'Yankit requires yt-dlp.\nInstall it with: pip install yt-dlp');
        app.quit();
        return;
    }

    createWindow();
});

app.on('window-all-closed', () => {
    if (dl) dl.cleanupAll();
    app.quit();
});

ipcMain.handle('fetch-info', (_, url) => dl.fetchInfo(url));

ipcMain.handle('start-download', (_, data) => {
    return { downloadId: dl.startDownload(data) };
});

ipcMain.handle('cancel-download', (_, id) => {
    dl.cancelDownload(id);
    return true;
});

ipcMain.handle('remove-download', (_, id) => {
    dl.removeDownload(id);
    return true;
});

ipcMain.handle('get-all-status', () => dl.getAllStatus());

ipcMain.handle('get-settings', () => dl.loadSettings());

ipcMain.handle('save-setting', (_, key, value) => {
    const s = dl.loadSettings();
    s[key] = value;
    dl.saveSettings(s);
    return true;
});

ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        defaultPath: dl.loadSettings().downloadPath,
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const s = dl.loadSettings();
        s.downloadPath = result.filePaths[0];
        dl.saveSettings(s);
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('open-file', async (_, filepath) => {
    if (!filepath) return;
    filepath = path.resolve(filepath);
    if (fs.existsSync(filepath)) await shell.openPath(filepath);
});

ipcMain.handle('show-in-folder', (_, filepath) => {
    if (!filepath) return;
    filepath = path.resolve(filepath);
    if (fs.existsSync(filepath)) shell.showItemInFolder(filepath);
});

ipcMain.handle('open-folder', () => {
    const dir = dl.loadSettings().downloadPath;
    if (fs.existsSync(dir)) shell.openPath(dir);
});

ipcMain.handle('open-url', (_, url) => shell.openExternal(url));

ipcMain.handle('check-update', () => checkForUpdate());

ipcMain.handle('get-version', () => PKG.version);
