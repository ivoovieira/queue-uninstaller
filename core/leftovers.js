const { spawn } = require('child_process');
const path = require('path');

function scanLeftovers(app, scanLevel = 'Moderate') {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'scan_leftovers.ps1');

        const cleanLocation = (app.InstallLocation || '').replace(/^"|"$/g, '').trim();

        const args = [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-DisplayName', app.DisplayName,
            '-Publisher', app.Publisher || '',
            '-InstallLocation', cleanLocation,
            '-RegistryId', app.Id || '',
            '-ScanLevel', scanLevel
        ];

        const child = spawn('powershell.exe', args, { windowsHide: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('close', (code) => {
            try {
                const jsonStart = stdout.indexOf('{');
                if (jsonStart === -1) {
                    return resolve({
                        DisplayName: app.DisplayName,
                        RegistryLeftovers: [],
                        FileSystemLeftovers: [],
                        TotalRegistryCount: 0,
                        TotalFileSystemCount: 0,
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
                    TotalRegistryCount: 0,
                    TotalFileSystemCount: 0,
                    TotalSizeBytes: 0,
                    error: err.message
                });
            }
        });
    });
}

function cleanLeftovers(items) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'clean_leftovers.ps1');
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
    });
}

module.exports = { scanLeftovers, cleanLeftovers };
