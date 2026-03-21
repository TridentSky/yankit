const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const Downloader = require('./downloader');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let PKG_VERSION = '1.0.0';
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    PKG_VERSION = pkg.version || '1.0.0';
} catch {}

app.disableHardwareAcceleration();


const DATA_DIR = IS_WIN
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Yankit')
    : IS_MAC
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Yankit')
        : path.join(os.homedir(), '.config', 'yankit');

const CACHE_DIR = IS_WIN
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Yankit')
    : path.join(DATA_DIR, 'Cache');


for (const dir of [DATA_DIR, CACHE_DIR]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

app.setPath('userData', DATA_DIR);
app.setPath('cache', CACHE_DIR);
app.setPath('temp', path.join(CACHE_DIR, 'Temp'));

let mainWindow;
let dl;

function sendToRenderer(channel, data) {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
    } catch {}
}

function checkForUpdate() {
    return new Promise(resolve => {
        const req = https.get({
            hostname: 'api.github.com',
            path: '/repos/TridentSky/yankit/releases/latest',
            headers: { 'User-Agent': 'Yankit' },
            timeout: 10000,
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) { resolve(null); return; }
                    const r = JSON.parse(data);
                    const latest = (r.tag_name || '').replace(/^v/, '');
                    const lp = latest.split('.').map(Number);
                    const cp = PKG_VERSION.split('.').map(Number);
                    let newer = false;
                    for (let i = 0; i < 3; i++) {
                        if ((lp[i] || 0) > (cp[i] || 0)) { newer = true; break; }
                        if ((lp[i] || 0) < (cp[i] || 0)) break;
                    }
                    if (newer) {

                        const asset = (r.assets || []).find(a => a.name && a.name.endsWith('.exe'));
                        resolve({
                            version: latest,
                            url: r.html_url,
                            downloadUrl: asset ? asset.browser_download_url : r.html_url,
                        });
                    } else {
                        resolve(null);
                    }
                } catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

function getIconPath() {
    const paths = [
        path.join(__dirname, 'build', 'icon.ico'),
        path.join(process.resourcesPath || __dirname, 'build', 'icon.ico'),
    ];
    for (const p of paths) {
        try { if (fs.existsSync(p)) return p; } catch {}
    }
    return undefined;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 920, height: 720,
        minWidth: 650, minHeight: 520,
        backgroundColor: '#0D0D14',
        title: 'Yankit Downloader',
        autoHideMenuBar: true,
        show: false,
        icon: getIconPath(),
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
        if (dl && dl.hasActive()) {
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
        if (dl) dl.cleanupAll();
    });
}

app.whenReady().then(() => {
    let binDir = path.join(__dirname, 'bin');
    if (app.isPackaged) {
        binDir = path.join(process.resourcesPath, 'bin');
    }

    const settingsPath = path.join(DATA_DIR, 'settings.json');

    dl = new Downloader({
        binDir, settingsPath,
        onUpdate: (data) => sendToRenderer('download-update', data),
    });

    const found = dl.init();

    createWindow();

    if (!found) {
        mainWindow.once('ready-to-show', () => {
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'yt-dlp Not Found',
                message: 'Yankit could not find yt-dlp.',
                detail: 'The bundled yt-dlp binary may be missing or blocked by antivirus.\n\n'
                    + 'Checked: ' + path.join(binDir, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp') + '\n\n'
                    + 'If the file exists, try adding an antivirus exception for the Yankit install folder.',
            });
        });
    }
});

app.on('window-all-closed', () => {
    if (dl) dl.cleanupAll();
    app.quit();
});

ipcMain.handle('fetch-info', async (_, url) => {
    try { return await dl.fetchInfo(url); }
    catch (e) { return { error: e.message || 'Fetch failed' }; }
});

ipcMain.handle('start-download', (_, data) => {
    try {
        const result = dl.startDownload(data);
        if (result && result.exists) return result;
        return { downloadId: result };
    }
    catch (e) { return { error: e.message || 'Download failed' }; }
});

ipcMain.handle('cancel-download', (_, id) => {
    try { dl.cancelDownload(id); } catch {}
    return true;
});

ipcMain.handle('remove-download', (_, id) => {
    try { dl.removeDownload(id); } catch {}
    return true;
});

ipcMain.handle('get-all-status', () => {
    try { return dl.getAllStatus(); } catch { return []; }
});

ipcMain.handle('get-settings', () => {
    try { return dl.loadSettings(); }
    catch { return { downloadPath: path.join(os.homedir(), 'Downloads'), theme: 'dark' }; }
});

ipcMain.handle('save-setting', (_, key, value) => {
    try {
        const s = dl.loadSettings();
        s[key] = value;
        dl.saveSettings(s);
    } catch {}
    return true;
});

ipcMain.handle('pick-folder', async () => {
    try {
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
    } catch {}
    return null;
});

ipcMain.handle('open-file', async (_, filepath) => {
    try {
        if (!filepath) return;
        filepath = path.resolve(filepath);
        const dlDir = path.resolve(dl.loadSettings().downloadPath);
        if (!filepath.startsWith(dlDir + path.sep) && filepath !== dlDir) return;
        if (fs.existsSync(filepath)) await shell.openPath(filepath);
    } catch {}
});

ipcMain.handle('show-in-folder', (_, filepath) => {
    try {
        if (!filepath) return;
        filepath = path.resolve(filepath);
        const dlDir = path.resolve(dl.loadSettings().downloadPath);
        if (!filepath.startsWith(dlDir + path.sep) && filepath !== dlDir) return;
        if (fs.existsSync(filepath)) shell.showItemInFolder(filepath);
    } catch {}
});

ipcMain.handle('open-folder', () => {
    try {
        const dir = dl.loadSettings().downloadPath;
        if (fs.existsSync(dir)) shell.openPath(dir);
    } catch {}
});

ipcMain.handle('open-url', (_, url) => {
    try { shell.openExternal(url); } catch {}
});

ipcMain.handle('check-update', () => checkForUpdate());

ipcMain.handle('get-version', () => PKG_VERSION);
