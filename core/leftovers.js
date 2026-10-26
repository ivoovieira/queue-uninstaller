const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function scanLeftovers(app, scanLevel = 'Moderate') {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'scan_leftovers.ps1');
        const cleanLocation = (app.InstallLocation || '').replace(/^"|"$/g, '').trim();

        const args = [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-DisplayName', app.DisplayName || '',
            '-Publisher', app.Publisher || '',
            '-InstallLocation', cleanLocation,
            '-RegistryId', app.Id || '',
            '-ScanLevel', scanLevel
        ];

        const child = spawn('powershell.exe', args, { windowsHide: true });

        let stdout = '';
        let stderr = '';
        let isDone = false;

        // Watchdog de 35s para evitar qualquer travamento na varredura
        const timer = setTimeout(() => {
            if (!isDone) {
                isDone = true;
                try { child.kill('SIGKILL'); } catch (e) {}
                console.warn(`[Timeout] Varredura de sobras excedeu 35s para: ${app.DisplayName}`);
                resolve({
                    DisplayName: app.DisplayName,
                    RegistryLeftovers: [],
                    FileSystemLeftovers: [],
                    FirewallRulesLeftovers: [],
                    TotalRegistryCount: 0,
                    TotalFileSystemCount: 0,
                    TotalFirewallCount: 0,
                    TotalSizeBytes: 0,
                    TimedOut: true
                });
            }
        }, 35000);

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('close', (code) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);

            try {
                const jsonStart = stdout.indexOf('{');
                if (jsonStart === -1) {
                    return resolve({
                        DisplayName: app.DisplayName,
                        RegistryLeftovers: [],
                        FileSystemLeftovers: [],
                        FirewallRulesLeftovers: [],
                        TotalRegistryCount: 0,
                        TotalFileSystemCount: 0,
                        TotalFirewallCount: 0,
                        TotalSizeBytes: 0
                    });
                }
                const result = JSON.parse(stdout.substring(jsonStart));
                resolve(result);
            } catch (err) {
                console.error('Erro ao ler sobras:', stderr || err.message);
                resolve({
                    DisplayName: app.DisplayName,
                    RegistryLeftovers: [],
                    FileSystemLeftovers: [],
                    FirewallRulesLeftovers: [],
                    TotalRegistryCount: 0,
                    TotalFileSystemCount: 0,
                    TotalFirewallCount: 0,
                    TotalSizeBytes: 0,
                    error: err.message
                });
            }
        });

        child.on('error', (err) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            resolve({
                DisplayName: app.DisplayName,
                RegistryLeftovers: [],
                FileSystemLeftovers: [],
                FirewallRulesLeftovers: [],
                TotalRegistryCount: 0,
                TotalFileSystemCount: 0,
                TotalFirewallCount: 0,
                TotalSizeBytes: 0,
                error: err.message
            });
        });
    });
}

function cleanLeftovers(items) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'clean_leftovers.ps1');
        const tempJsonFile = path.join(os.tmpdir(), `queu_clean_leftovers_${Date.now()}.json`);

        try {
            fs.writeFileSync(tempJsonFile, JSON.stringify(items || {}), 'utf8');
        } catch (e) {
            console.error('Erro ao salvar arquivo temporário de sobras:', e);
            return resolve({
                Success: false,
                RemovedFilesCount: 0,
                RemovedRegistryCount: 0,
                Errors: [`Falha ao salvar dados temporários: ${e.message}`]
            });
        }

        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-JsonPath', tempJsonFile
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';
        let isDone = false;

        const cleanupTemp = () => {
            try {
                if (fs.existsSync(tempJsonFile)) {
                    fs.unlinkSync(tempJsonFile);
                }
            } catch (e) {}
        };

        // Watchdog de 30s para evitar travamento da fila inteira
        const timer = setTimeout(() => {
            if (!isDone) {
                isDone = true;
                try { child.kill('SIGKILL'); } catch (e) {}
                cleanupTemp();
                console.warn('[Timeout] Limpeza de sobras excedeu 30s. Liberando fila com segurança.');
                resolve({
                    Success: false,
                    RemovedFilesCount: 0,
                    RemovedRegistryCount: 0,
                    Errors: ['Tempo limite excedido na limpeza de sobras (30s). A fila continuou com segurança.']
                });
            }
        }, 30000);

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('close', (code) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            cleanupTemp();

            try {
                const jsonStart = stdout.indexOf('{');
                if (jsonStart !== -1) {
                    const res = JSON.parse(stdout.substring(jsonStart));
                    return resolve(res);
                }
            } catch (err) {}
            resolve({
                Success: false,
                RemovedFilesCount: 0,
                RemovedRegistryCount: 0,
                Errors: [stderr || 'Erro desconhecido ao limpar sobras']
            });
        });

        child.on('error', (err) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            cleanupTemp();
            resolve({
                Success: false,
                RemovedFilesCount: 0,
                RemovedRegistryCount: 0,
                Errors: [err.message]
            });
        });
    });
}

module.exports = { scanLeftovers, cleanLeftovers };
