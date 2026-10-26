const { spawn, execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { cleanLeftovers } = require('./leftovers');

function isElevated() {
    if (process.platform !== 'win32') return true;
    try {
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

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
        const orphanRegItems = [];
        if (app.RegistryPath) {
            orphanRegItems.push({
                KeyPath: app.RegistryPath,
                PSPath: app.RegistryPath.startsWith('HKLM') || app.RegistryPath.startsWith('HKCU')
                    ? app.RegistryPath
                    : (app.RegistryPath.toLowerCase().includes('hkey_local_machine')
                        ? app.RegistryPath.replace(/HKEY_LOCAL_MACHINE/i, 'HKLM:')
                        : app.RegistryPath.replace(/HKEY_CURRENT_USER/i, 'HKCU:')),
                Description: `Chave órfã de desinstalação (${app.DisplayName})`
            });
        }
        const cleanPayload = {
            RegistryLeftovers: orphanRegItems,
            FileSystemLeftovers: []
        };
        const cleanRes = await cleanLeftovers(cleanPayload);
        return {
            success: cleanRes.Success,
            isOrphan: true,
            message: cleanRes.Success
                ? 'Entrada órfã removida com sucesso diretamente do Registro do Windows.'
                : (cleanRes.Errors && cleanRes.Errors[0]) || 'Falha ao remover chave órfã do Registro.',
            lockedProcessesKilled: [],
            stillExists: false
        };
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

        const needsElevation = !isElevated() && (
            (app.RegistryPath && (app.RegistryPath.toLowerCase().includes('hklm') || app.RegistryPath.toLowerCase().includes('hkey_local_machine'))) ||
            (app.InstallLocation && (app.InstallLocation.toLowerCase().includes('program files') || app.InstallLocation.toLowerCase().includes('programdata'))) ||
            (commandToRun && (commandToRun.toLowerCase().includes('program files') || commandToRun.toLowerCase().includes('msiexec') || commandToRun.toLowerCase().includes('system32')))
        );

        if (needsElevation) {
            const tempRunnerFile = path.join(os.tmpdir(), `queu_uninst_runner_${Date.now()}.ps1`);
            const runnerScript = `
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c \`"${commandToRun.replace(/`/g, '``').replace(/"/g, '`"')}\`"" -Verb RunAs -PassThru -Wait
if ($proc) { exit $proc.ExitCode } else { exit 0 }
`;
            try {
                fs.writeFileSync(tempRunnerFile, runnerScript, 'utf8');
            } catch (e) {}

            const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempRunnerFile], {
                windowsHide: false,
                stdio: 'inherit'
            });

            child.on('close', (code) => {
                try { if (fs.existsSync(tempRunnerFile)) fs.unlinkSync(tempRunnerFile); } catch (e) {}
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
                try { if (fs.existsSync(tempRunnerFile)) fs.unlinkSync(tempRunnerFile); } catch (e) {}
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
            return;
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
