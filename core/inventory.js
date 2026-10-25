const { spawn } = require('child_process');
const path = require('path');

function parseStderrProgress(stderrChunk, state, onProgress) {
    state.buffer += stderrChunk;
    const lines = state.buffer.split(/\r?\n/);
    state.buffer = lines.pop(); // Mantém o resto da linha incompleta
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[PROGRESS]')) {
            try {
                const jsonStr = trimmed.substring(10).trim();
                const pData = JSON.parse(jsonStr);
                if (typeof onProgress === 'function') {
                    onProgress(pData);
                }
            } catch (e) {}
        }
    }
}

function getInstalledApps(onProgress) {
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
        const progressState = { buffer: '' };

        child.stdout.on('data', (data) => {
            stdout += data.toString('utf8');
        });

        child.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            stderr += chunk;
            parseStderrProgress(chunk, progressState, onProgress);
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

function getWindowsApps(onProgress) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'get_windows_apps.ps1');
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';
        const progressState = { buffer: '' };

        child.stdout.on('data', d => stdout += d.toString('utf8'));
        child.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            stderr += chunk;
            parseStderrProgress(chunk, progressState, onProgress);
        });

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
