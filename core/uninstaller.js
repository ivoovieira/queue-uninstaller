const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function killActiveLocks(app) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'kill_process_locks.ps1');
        const cleanLocation = (app.InstallLocation || '').replace(/^"|"$/g, '').trim();

        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-InstallLocation', cleanLocation,
            '-DisplayName', app.DisplayName || '',
            '-UninstallString', app.UninstallString || ''
        ], { windowsHide: true });

        let stdout = '';
        child.stdout.on('data', d => stdout += d.toString('utf8'));
        child.on('close', () => {
            try {
                const j = JSON.parse(stdout.substring(stdout.indexOf('{')));
                resolve(j);
            } catch (e) {
                resolve({ Success: true, KilledCount: 0, KilledProcesses: [] });
            }
        });
        child.on('error', () => {
            resolve({ Success: false, KilledCount: 0, KilledProcesses: [] });
        });
    });
}

function checkRemainingFiles(installLocation) {
    if (!installLocation) return { exists: false, count: 0 };
    const cleanPath = installLocation.replace(/^"|"$/g, '').trim();
    if (!cleanPath || !fs.existsSync(cleanPath)) return { exists: false, count: 0 };

    try {
        const files = fs.readdirSync(cleanPath);
        return { exists: files.length > 0, count: files.length, path: cleanPath };
    } catch (e) {
        return { exists: true, count: 1, path: cleanPath };
    }
}

async function runUninstall(app, options = {}) {
    // 0. Ação Segura para Entradas Órfãs (arquivos já ausentes no disco)
    if (app && app.IsOrphan) {
        return new Promise((resolve) => {
            const cleanScript = path.join(__dirname, '..', 'scripts', 'clean_leftovers.ps1');
            const orphanRegItems = [];
            if (app.RegistryPath) {
                orphanRegItems.push({
                    KeyPath: app.RegistryPath,
                    Description: `Chave órfã de desinstalação (${app.DisplayName})`
                });
            }
            const cleanPayload = {
                RegistryLeftovers: orphanRegItems,
                FileSystemLeftovers: []
            };

            const child = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', cleanScript,
                '-ItemsJson', JSON.stringify(cleanPayload)
            ], { windowsHide: true });

            let stdout = '';
            child.stdout.on('data', d => stdout += d.toString('utf8'));
            child.on('close', (code) => {
                resolve({
                    success: code === 0,
                    isOrphan: true,
                    message: 'Entrada órfã removida com sucesso diretamente do Registro do Windows.',
                    lockedProcessesKilled: [],
                    stillExists: false
                });
            });
            child.on('error', (err) => {
                resolve({
                    success: false,
                    isOrphan: true,
                    error: err.message,
                    lockedProcessesKilled: [],
                    stillExists: false
                });
            });
        });
    }

    // 1. Encerramento preventivo de processos ativos vinculados ao aplicativo
    const killResult = await killActiveLocks(app);

    return new Promise((resolve) => {
        const useSilent = options.silent !== false;
        let commandToRun = '';

        if (useSilent && app.QuietUninstallString && app.QuietUninstallString.trim()) {
            commandToRun = app.QuietUninstallString.trim();
        } else if (app.UninstallString && app.UninstallString.trim()) {
            commandToRun = app.UninstallString.trim();
        } else {
            // Se não houver comando de desinstalação, valida se há pasta para limpeza direta de sobras
            const remaining = checkRemainingFiles(app.InstallLocation);
            return resolve({
                success: false,
                skipped: true,
                message: 'Nenhum comando de desinstalação registrado no sistema.',
                lockedProcessesKilled: killResult.KilledProcesses || [],
                stillExists: remaining.exists,
                remainingPath: remaining.path
            });
        }

        // Executa o desinstalador via cmd.exe /s /c
        const child = spawn('cmd.exe', ['/s', '/c', commandToRun], {
            windowsHide: false,
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            // 2. Validação pós-desinstalação: checa se a pasta/executável ainda permanece no disco
            const remaining = checkRemainingFiles(app.InstallLocation);

            resolve({
                success: code === 0 || code === 3010,
                exitCode: code,
                command: commandToRun,
                lockedProcessesKilled: killResult.KilledProcesses || [],
                stillExists: remaining.exists,
                remainingPath: remaining.path
            });
        });

        child.on('error', (err) => {
            const remaining = checkRemainingFiles(app.InstallLocation);
            resolve({
                success: false,
                error: err.message,
                command: commandToRun,
                lockedProcessesKilled: killResult.KilledProcesses || [],
                stillExists: remaining.exists,
                remainingPath: remaining.path
            });
        });
    });
}

module.exports = { runUninstall, killActiveLocks, checkRemainingFiles };
