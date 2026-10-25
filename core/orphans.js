const { spawn } = require('child_process');
const path = require('path');

function scanOrphans() {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'scan_orphaned_residuals.ps1');

        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('close', (code) => {
            try {
                const jsonStart = stdout.indexOf('{');
                if (jsonStart !== -1) {
                    const result = JSON.parse(stdout.substring(jsonStart));
                    return resolve(result);
                }
            } catch (err) {
                console.error('Erro no parser de órfãos:', err);
            }
            resolve({
                Success: false,
                Items: [],
                TotalCount: 0,
                TotalSizeBytes: 0,
                SafeCount: 0,
                ReviewCount: 0,
                Error: stderr || 'Falha ao varrer resíduos órfãos'
            });
        });
    });
}

function cleanOrphans(items) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'clean_orphaned_residuals.ps1');
        const jsonStr = JSON.stringify(items);

        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-ItemsJson', jsonStr
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('close', (code) => {
            try {
                const jsonStart = stdout.indexOf('{');
                if (jsonStart !== -1) {
                    const result = JSON.parse(stdout.substring(jsonStart));
                    return resolve(result);
                }
            } catch (err) {
                console.error('Erro no parser de limpeza de órfãos:', err);
            }
            resolve({
                Success: false,
                RemovedCount: 0,
                RemovedBytes: 0,
                RemovedItems: [],
                Errors: [stderr || 'Falha ao limpar resíduos órfãos']
            });
        });
    });
}

module.exports = { scanOrphans, cleanOrphans };
