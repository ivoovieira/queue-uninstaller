const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { getInstalledApps, getWindowsApps } = require('./core/inventory');
const { runUninstall } = require('./core/uninstaller');
const { scanLeftovers, cleanLeftovers } = require('./core/leftovers');
const { createRestorePoint } = require('./core/restore');
const { checkForUpdates, applyUpdate } = require('./core/updater');

let mainWindow = null;
let isBatchCancelled = false;
let isBatchRunning = false;
const HTTP_PORT = 38456;
let sseClients = [];

function sendSSE(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(res => {
        try { res.write(payload); } catch (e) {}
    });
}

// Inicia servidor HTTP interno com CORS para garantir que mesmo se carregar via Web ou file:// tudo funcione
function startInternalServer() {
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml'
    };

    const server = http.createServer(async (req, res) => {
        // Headers CORS universais
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            return res.end();
        }

        const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
        const pathname = url.pathname;

        if (pathname === '/api/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            sseClients.push(res);
            req.on('close', () => {
                sseClients = sseClients.filter(c => c !== res);
            });
            return;
        }

        if (pathname === '/api/apps' && req.method === 'GET') {
            try {
                const apps = await getInstalledApps();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify(apps));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: err.message }));
            }
        }

        if (pathname === '/api/windows-apps' && req.method === 'GET') {
            try {
                const apps = await getWindowsApps();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify(apps));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: err.message }));
            }
        }

        if (pathname === '/api/scan' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const { app: appItem, scanLevel } = JSON.parse(body);
                    const result = await scanLeftovers(appItem, scanLevel || 'Moderate');
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        if (pathname === '/api/clean' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const items = JSON.parse(body);
                    const result = await cleanLeftovers(items);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        if (pathname === '/api/restore' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const { desc } = JSON.parse(body || '{}');
                    const result = await createRestorePoint(desc || 'Queu Ponto de Restauração');
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        if (pathname === '/api/uninstall' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const { app: appItem, options } = JSON.parse(body);
                    const result = await runUninstall(appItem, options);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        if (pathname === '/api/cancel-batch' && req.method === 'POST') {
            isBatchCancelled = true;
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ cancelled: true }));
        }

        if (pathname === '/api/check-update' && req.method === 'GET') {
            const updateInfo = await checkForUpdates();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(updateInfo));
        }

        if (pathname === '/api/apply-update' && req.method === 'POST') {
            const result = await applyUpdate();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        if (pathname === '/api/batch' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                const { apps, options } = JSON.parse(body);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ started: true }));

                runBatchQueue(apps, options);
            });
            return;
        }

        // Estáticos
        let filePath = path.join(__dirname, 'src', pathname === '/' ? 'index.html' : pathname);
        fs.stat(filePath, (err, stats) => {
            if (err || !stats.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Arquivo não encontrado');
            }
            const ext = path.extname(filePath).toLowerCase();
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(filePath).pipe(res);
        });
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`Porta ${HTTP_PORT} já em uso, continuando com instância existente...`);
        } else {
            console.error('Erro no servidor interno:', e.message);
        }
    });

    server.listen(HTTP_PORT, () => {
        console.log(`Servidor interno Queu Uninstaller rodando em http://localhost:${HTTP_PORT}`);
    });
}

async function runBatchQueue(apps, options = {}) {
    if (isBatchRunning) return;
    isBatchRunning = true;
    isBatchCancelled = false;
    const total = apps.length;
    const results = [];

    const notify = (data) => {
        sendSSE(data);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('batch-status', data);
        }
    };

    if (options.createRestorePoint) {
        notify({ type: 'status-update', message: 'Criando ponto de restauração do sistema...' });
        await createRestorePoint(`Queu Fila (${total} apps)`);
    }

    for (let i = 0; i < total; i++) {
        if (isBatchCancelled) {
            notify({ type: 'batch-cancelled', currentIndex: i, total });
            break;
        }

        const currentApp = apps[i];
        notify({ type: 'app-start', index: i, total, app: currentApp });

        const uninstallRes = await runUninstall(currentApp, {
            silent: options.silentMode !== false
        });

        let leftoverRes = null;
        let cleanRes = null;

        if (options.scanLeftovers !== false) {
            notify({ type: 'app-scanning', index: i, app: currentApp });
            leftoverRes = await scanLeftovers(currentApp, options.scanLevel || 'Moderate');

            if (options.autoCleanLeftovers && (leftoverRes.TotalRegistryCount > 0 || leftoverRes.TotalFileSystemCount > 0 || (leftoverRes.TotalFirewallCount && leftoverRes.TotalFirewallCount > 0))) {
                notify({ type: 'app-cleaning', index: i, app: currentApp });
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

        notify({ type: 'app-done', index: i, total, summary: appSummary });
    }

    isBatchRunning = false;
    notify({ type: 'batch-completed', totalProcessed: results.length, results });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1260,
        height: 840,
        minWidth: 1000,
        minHeight: 650,
        backgroundColor: '#0f172a',
        icon: path.join(__dirname, 'icon.ico'),
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#1e293b',
            symbolColor: '#f8fafc',
            height: 48
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false
        },
        show: false,
        title: "Queu Uninstaller"
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
    startInternalServer();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers para quando rodar via Electron nativo
ipcMain.handle('get-installed-apps', async () => {
    return await getInstalledApps();
});

ipcMain.handle('get-windows-apps', async () => {
    return await getWindowsApps();
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
    if (folderPath) shell.openPath(folderPath);
});

ipcMain.handle('cancel-batch', () => {
    isBatchCancelled = true;
    return { cancelled: true };
});

ipcMain.handle('start-batch-uninstall', async (event, apps, options = {}) => {
    runBatchQueue(apps, options);
    return { success: true };
});

ipcMain.handle('check-for-updates', async () => {
    return await checkForUpdates();
});

ipcMain.handle('apply-update', async () => {
    const res = await applyUpdate();
    if (res.success && app.relaunch) {
        setTimeout(() => {
            app.relaunch();
            app.exit(0);
        }, 1500);
    }
    return res;
});
