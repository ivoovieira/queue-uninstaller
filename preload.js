const { contextBridge, ipcRenderer } = require('electron');

const api = {
    getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
    getWindowsApps: () => ipcRenderer.invoke('get-windows-apps'),
    scanLeftovers: (app, scanLevel) => ipcRenderer.invoke('scan-leftovers', app, scanLevel),
    cleanLeftovers: (items) => ipcRenderer.invoke('clean-leftovers', items),
    createRestorePoint: (desc) => ipcRenderer.invoke('create-restore-point', desc),
    runSingleUninstall: (app, options) => ipcRenderer.invoke('run-single-uninstall', app, options),
    startBatchUninstall: (apps, options) => ipcRenderer.invoke('start-batch-uninstall', apps, options),
    cancelBatch: () => ipcRenderer.invoke('cancel-batch'),
    openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
    scanOrphans: () => ipcRenderer.invoke('scan-orphans'),
    cleanOrphans: (items) => ipcRenderer.invoke('clean-orphans', items),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    applyUpdate: () => ipcRenderer.invoke('apply-update'),
    
    onBatchStatus: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('batch-status', sub);
        return () => ipcRenderer.removeListener('batch-status', sub);
    },
    onScanProgress: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('scan-progress', sub);
        return () => ipcRenderer.removeListener('scan-progress', sub);
    }
};

if (process.contextIsolated && contextBridge && contextBridge.exposeInMainWorld) {
    try {
        contextBridge.exposeInMainWorld('api', api);
    } catch (e) {
        console.error('Erro ao expor contextBridge:', e);
    }
}

try {
    window.api = api;
} catch (e) {}
