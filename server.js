const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getInstalledApps } = require('./core/inventory');
const { runUninstall } = require('./core/uninstaller');
const { scanLeftovers, cleanLeftovers } = require('./core/leftovers');
const { createRestorePoint } = require('./core/restore');
const { scanOrphans, cleanOrphans } = require('./core/orphans');

const PORT = 38456;
let sseClients = [];
let isBatchCancelled = false;
let isBatchRunning = false;

function sendSSE(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(res => res.write(payload));
}

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
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // SSE para status da fila
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

    // API Handlers
    if (pathname === '/api/apps' && req.method === 'GET') {
        try {
            const apps = await getInstalledApps();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(apps));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    if (pathname === '/api/scan' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const { app, scanLevel } = JSON.parse(body);
                const result = await scanLeftovers(app, scanLevel || 'Moderate');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
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
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
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
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
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
                const { app, options } = JSON.parse(body);
                const result = await runUninstall(app, options);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    if (pathname === '/api/cancel-batch' && req.method === 'POST') {
        isBatchCancelled = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ cancelled: true }));
    }

    if (pathname === '/api/scan-orphans' && req.method === 'GET') {
        try {
            const result = await scanOrphans();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    if (pathname === '/api/clean-orphans' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const items = JSON.parse(body || '[]');
                const result = await cleanOrphans(items);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    if (pathname === '/api/batch' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            const { apps, options } = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ started: true }));

            // Executa em segundo plano e transmite via SSE
            isBatchRunning = true;
            isBatchCancelled = false;
            const total = apps.length;
            const results = [];

            if (options.createRestorePoint) {
                sendSSE({
                    type: 'status-update',
                    message: 'Criando ponto de restauração do sistema...'
                });
                await createRestorePoint(`Queu Fila (${total} apps)`);
            }

            for (let i = 0; i < total; i++) {
                if (isBatchCancelled) {
                    sendSSE({ type: 'batch-cancelled', currentIndex: i, total });
                    break;
                }

                const currentApp = apps[i];
                sendSSE({ type: 'app-start', index: i, total, app: currentApp });

                const uninstallRes = await runUninstall(currentApp, {
                    silent: options.silentMode !== false
                });

                let leftoverRes = null;
                let cleanRes = null;

                if (options.scanLeftovers !== false) {
                    sendSSE({ type: 'app-scanning', index: i, app: currentApp });
                    leftoverRes = await scanLeftovers(currentApp, options.scanLevel || 'Moderate');

                    if (options.autoCleanLeftovers && (leftoverRes.TotalRegistryCount > 0 || leftoverRes.TotalFileSystemCount > 0 || (leftoverRes.TotalFirewallCount && leftoverRes.TotalFirewallCount > 0))) {
                        sendSSE({ type: 'app-cleaning', index: i, app: currentApp });
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

                sendSSE({ type: 'app-done', index: i, total, summary: appSummary });
            }

            isBatchRunning = false;
            sendSSE({ type: 'batch-completed', totalProcessed: results.length, results });
        });
        return;
    }

    // Servir arquivos estáticos do frontend (src/)
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

server.listen(PORT, () => {
    console.log(`Queu Uninstaller rodando em http://localhost:${PORT}`);
    
    // Tenta abrir como app nativo no Edge do Windows
    const appUrl = `http://localhost:${PORT}`;
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (fs.existsSync(edgePath)) {
        spawn(edgePath, [`--app=${appUrl}`, '--window-size=1260,840']);
    } else {
        spawn('cmd.exe', ['/c', 'start', appUrl]);
    }
});
