const { spawn } = require('child_process');
const path = require('path');

function getInstalledApps() {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'get_installed_apps.ps1');
        
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], {
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 50 // 50MB buffer
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString('utf8');
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString('utf8');
        });

        child.on('close', (code) => {
            if (code !== 0 && !stdout) {
                return reject(new Error(`Erro ao listar programas (Exit Code ${code}): ${stderr}`));
            }

            try {
                // Remove qualquer texto antes do primeiro '[' caso algum profile do powershell imprima algo
                const jsonStart = stdout.indexOf('[');
                if (jsonStart === -1) {
                    return resolve([]);
                }
                const cleanJson = stdout.substring(jsonStart);
                const apps = JSON.parse(cleanJson);
                resolve(apps);
            } catch (err) {
                reject(new Error(`Falha no parse dos programas instalados: ${err.message}`));
            }
        });
    });
}

function getWindowsApps() {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'get_windows_apps.ps1');
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], { windowsHide: true });

        let stdout = '';
        child.stdout.on('data', d => stdout += d.toString('utf8'));
        child.on('close', () => {
            try {
                const jsonStart = stdout.indexOf('[');
                if (jsonStart !== -1) {
                    return resolve(JSON.parse(stdout.substring(jsonStart)));
                }
            } catch (e) {}
            resolve([]);
        });
    });
}

module.exports = { getInstalledApps, getWindowsApps };
