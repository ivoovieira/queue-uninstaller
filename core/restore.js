const { spawn, execSync } = require('child_process');
const path = require('path');

function isElevated() {
    if (process.platform !== 'win32') return true;
    try {
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function createRestorePoint(description = 'Queu Ponto de Restauração') {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'create_restore.ps1');

        if (!isElevated()) {
            // Se o processo ainda não estiver em modo Administrador, eleva via RunAs
            const cmd = `Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\"${scriptPath}\\" -Description \\"${description}\\"' -Verb RunAs -Wait`;
            const child = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true });
            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ Success: true, Message: `Ponto de restauração '${description}' criado com sucesso!` });
                } else {
                    resolve({ Success: false, Message: 'Operação cancelada ou permissão de Administrador negada no UAC.' });
                }
            });
            return;
        }

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
