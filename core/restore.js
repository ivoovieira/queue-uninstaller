const { spawn } = require('child_process');
const path = require('path');

function createRestorePoint(description = 'RevoClone Batch Uninstaller') {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'create_restore.ps1');

        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-Description', description
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('close', () => {
            try {
                const jsonStart = stdout.indexOf('{');
                if (jsonStart !== -1) {
                    return resolve(JSON.parse(stdout.substring(jsonStart)));
                }
            } catch (e) {}
            resolve({
                Success: false,
                Message: stderr || 'Falha ao acionar criação de ponto de restauração'
            });
        });
    });
}

module.exports = { createRestorePoint };
