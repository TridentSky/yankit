const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    fetchInfo: (url) => ipcRenderer.invoke('fetch-info', url),
    startDownload: (data) => ipcRenderer.invoke('start-download', data),
    cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
    removeDownload: (id) => ipcRenderer.invoke('remove-download', id),
    getAllStatus: () => ipcRenderer.invoke('get-all-status'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
    pickFolder: () => ipcRenderer.invoke('pick-folder'),
    openFile: (filepath) => ipcRenderer.invoke('open-file', filepath),
    showInFolder: (filepath) => ipcRenderer.invoke('show-in-folder', filepath),
    openFolder: () => ipcRenderer.invoke('open-folder'),
    openUrl: (url) => ipcRenderer.invoke('open-url', url),
    onDownloadUpdate: (cb) => ipcRenderer.on('download-update', (_, data) => cb(data)),
    checkUpdate: () => ipcRenderer.invoke('check-update'),
    getVersion: () => ipcRenderer.invoke('get-version'),
});
