const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { getInstalledApps } = require('./core/inventory');
const { runUninstall } = require('./core/uninstaller');
const { scanLeftovers, cleanLeftovers } = require('./core/leftovers');
const { createRestorePoint } = require('./core/restore');

let mainWindow = null;
let isBatchCancelled = false;
let isBatchRunning = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1260,
        height: 840,
        minWidth: 1000,
        minHeight: 650,
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false,
        title: "RevoClone - Desinstalador em Fila & Limpeza Profunda"
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Remove menu padrão do Electron para ficar com cara de aplicativo moderno limpo
    mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('get-installed-apps', async () => {
    return await getInstalledApps();
});

ipcMain.handle('scan-leftovers', async (event, appItem, scanLevel) => {
    return await scanLeftovers(appItem, scanLevel);
});

ipcMain.handle('clean-leftovers', async (event, items) => {
    return await cleanLeftovers(items);
});

ipcMain.handle('create-restore-point', async (event, desc) => {
    return await createRestorePoint(desc);
});

ipcMain.handle('run-single-uninstall', async (event, appItem, options) => {
    return await runUninstall(appItem, options);
});

ipcMain.handle('open-folder', async (event, folderPath) => {
    if (folderPath) {
        shell.openPath(folderPath);
    }
});

ipcMain.handle('cancel-batch', () => {
    isBatchCancelled = true;
    return { cancelled: true };
});

ipcMain.handle('start-batch-uninstall', async (event, apps, options = {}) => {
    if (isBatchRunning) {
        return { error: 'Uma fila já está em execução.' };
    }

    isBatchRunning = true;
    isBatchCancelled = false;

    const total = apps.length;
    const results = [];

    // 1. Ponto de restauração opcional antes da fila
    if (options.createRestorePoint) {
        mainWindow.webContents.send('batch-status', {
            type: 'status-update',
            phase: 'restore-point',
            message: 'Criando ponto de restauração do sistema...'
        });
        await createRestorePoint(`RevoClone Fila (${total} apps)`);
    }

    for (let i = 0; i < total; i++) {
        if (isBatchCancelled) {
            mainWindow.webContents.send('batch-status', {
                type: 'batch-cancelled',
                currentIndex: i,
                total
            });
            break;
        }

        const currentApp = apps[i];

        // Notifica início de desinstalação
        mainWindow.webContents.send('batch-status', {
            type: 'app-start',
            index: i,
            total,
            app: currentApp
        });

        // 2. Executa desinstalador
        const uninstallRes = await runUninstall(currentApp, {
            silent: options.silentMode !== false
        });

        // 3. Varredura de sobras
        let leftoverRes = null;
        let cleanRes = null;

        if (options.scanLeftovers !== false) {
            mainWindow.webContents.send('batch-status', {
                type: 'app-scanning',
                index: i,
                app: currentApp
            });

            leftoverRes = await scanLeftovers(currentApp, options.scanLevel || 'Moderate');

            // 4. Limpeza automática se configurado
            if (options.autoCleanLeftovers && (leftoverRes.TotalRegistryCount > 0 || leftoverRes.TotalFileSystemCount > 0)) {
                mainWindow.webContents.send('batch-status', {
                    type: 'app-cleaning',
                    index: i,
                    app: currentApp
                });

                cleanRes = await cleanLeftovers(leftoverRes);
            }
        }

        const appSummary = {
            app: currentApp,
            uninstallResult: uninstallRes,
            leftovers: leftoverRes,
            cleanResult: cleanRes
        };

        results.push(appSummary);

        // Notifica conclusão do item
        mainWindow.webContents.send('batch-status', {
            type: 'app-done',
            index: i,
            total,
            summary: appSummary
        });
    }

    isBatchRunning = false;

    mainWindow.webContents.send('batch-status', {
        type: 'batch-completed',
        totalProcessed: results.length,
        results
    });

    return { success: true, results };
});
