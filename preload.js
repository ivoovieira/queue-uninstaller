const { contextBridge, ipcRenderer } = require('electron');

const api = {
    getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
    scanLeftovers: (app, scanLevel) => ipcRenderer.invoke('scan-leftovers', app, scanLevel),
    cleanLeftovers: (items) => ipcRenderer.invoke('clean-leftovers', items),
    createRestorePoint: (desc) => ipcRenderer.invoke('create-restore-point', desc),
    runSingleUninstall: (app, options) => ipcRenderer.invoke('run-single-uninstall', app, options),
    startBatchUninstall: (apps, options) => ipcRenderer.invoke('start-batch-uninstall', apps, options),
    cancelBatch: () => ipcRenderer.invoke('cancel-batch'),
    openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    applyUpdate: () => ipcRenderer.invoke('apply-update'),
    
    onBatchStatus: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('batch-status', sub);
        return () => ipcRenderer.removeListener('batch-status', sub);
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
