const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { cleanLeftovers } = require('./leftovers');

// =================================================================
// FUNÇÃO: Verificação de Privilégios de Administrador
// Objetivo: Determinar se o processo atual possui privilégios de execução elevados no Windows
// Entradas: Nenhuma
// Retornos: Boolean (true se elevado ou não-Windows, false se usuário restrito)
// =================================================================
function isElevated() {
    // ---------------------------------------------------------------
    // 1. VERIFICAÇÃO DE PLATAFORMA E EXECUÇÃO DO TESTE
    // ---------------------------------------------------------------
    if (process.platform !== 'win32') return true;

    // Nota didática: O comando 'net session' falha com código de acesso negado (5)
    // se executado por um processo sem privilégios administrativos. É uma das formas
    // mais rápidas e confiáveis de checagem nativa no Windows sem dependências externas.
    try {
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

// =================================================================
// FUNÇÃO: Encerramento de Processos em Bloqueio Ativo
// Objetivo: Localizar e encerrar preventivamente processos vinculados ao aplicativo antes da desinstalação
// Entradas: 'app' (Objeto de metadados do aplicativo contendo InstallLocation, DisplayName, etc.)
// Retornos: Promise<Object> contendo { Success: boolean, KilledCount: number, KilledProcesses: Array }
// =================================================================
function killActiveLocks(app) {
    return new Promise((resolve) => {
        // ---------------------------------------------------------------
        // 1. PREPARAÇÃO DO SCRIPT AUXILIAR DE ENCERRAMENTO
        // ---------------------------------------------------------------
        const scriptPath = path.join(__dirname, '..', 'scripts', 'kill_process_locks.ps1');
        const cleanLocation = (app.InstallLocation || '').replace(/^"|"$/g, '').trim();

        // ---------------------------------------------------------------
        // 2. DISPARO DO PROCESSO EM SEGUNDO PLANO
        // ---------------------------------------------------------------
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

        // ---------------------------------------------------------------
        // 3. CAPTURA E PARSE DO RESULTADO JSON
        // ---------------------------------------------------------------
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

// =================================================================
// FUNÇÃO: Verificação de Arquivos e Diretórios Remanescentes
// Objetivo: Checar se a pasta de instalação ainda retém conteúdo em disco após o desinstalador
// Entradas: 'installLocation' (string com caminho absoluto do diretório)
// Retornos: Object { exists: boolean, count: number, path?: string }
// =================================================================
function checkRemainingFiles(installLocation) {
    // ---------------------------------------------------------------
    // 1. HIGIENIZAÇÃO E VALIDAÇÃO DE EXISTÊNCIA
    // ---------------------------------------------------------------
    if (!installLocation) return { exists: false, count: 0 };
    const cleanPath = installLocation.replace(/^"|"$/g, '').trim();
    if (!cleanPath || !fs.existsSync(cleanPath)) return { exists: false, count: 0 };

    // ---------------------------------------------------------------
    // 2. CONTAGEM DE ITENS RESIDUAIS
    // ---------------------------------------------------------------
    try {
        const files = fs.readdirSync(cleanPath);
        return { exists: files.length > 0, count: files.length, path: cleanPath };
    } catch (e) {
        // Nota didática: Diretórios restritos (como C:\Program Files\WindowsApps) podem
        // gerar erro de EACCES no Node.js; se existe mas não lista, consideramos presente.
        return { exists: true, count: 1, path: cleanPath };
    }
}

// =================================================================
// FUNÇÃO: Desinstalação Nativa e Resiliente de Pacotes AppX / MSIX
// Objetivo: Remover aplicativos da Microsoft Store para todos os usuários ou usuário corrente, além de pacotes provisionados
// Entradas:
//   - 'app' (Objeto com metadados do aplicativo: Id, PackageFullName, PackageFamilyName, DisplayName)
//   - 'killResult' (Objeto com processos já encerrados previamente)
// Retornos: Promise<Object> com { success: boolean, exitCode: number, error?: string, lockedProcessesKilled: Array }
// =================================================================
function uninstallAppxPackage(app, killResult) {
    return new Promise((resolve) => {
        // ---------------------------------------------------------------
        // 1. IDENTIFICAÇÃO E HIGIENIZAÇÃO DO PACOTE
        // ---------------------------------------------------------------
        const pkgFullName = (app.Id || app.PackageFullName || '').replace(/^"|"$/g, '').trim();
        const pkgFamily = (app.PackageFamilyName || '').replace(/^"|"$/g, '').trim();

        // Nota didática: O identificador completo do pacote (PackageFullName) é essencial
        // para garantir remoção unívoca sem atingir versões concorrentes ou outros pacotes.
        const targetPkg = pkgFullName || pkgFamily;
        if (!targetPkg) {
            return resolve({
                success: false,
                exitCode: 1,
                error: 'Identificador PackageFullName ou PackageFamilyName ausente para o aplicativo AppX.',
                lockedProcessesKilled: killResult.KilledProcesses || []
            });
        }

        // ---------------------------------------------------------------
        // 2. CONSTRUÇÃO DO SCRIPT POWERSHELL RESILIENTE
        // ---------------------------------------------------------------
        // Nota didática: Se o processo do Queu Uninstaller estiver elevado como Administrador,
        // executar Remove-AppxPackage sem -AllUsers afeta apenas o perfil do Administrador.
        // O uso prioritário de -AllUsers garante remoção de todos os perfis, e o bloco de
        // fallback executa no perfil ativo caso ocorra restrição de escopo.
        const psScript = `
$target = '${targetPkg.replace(/'/g, "''")}';
$errList = [System.Collections.Generic.List[string]]::new();

# 1. Tenta remoção abrangente com -AllUsers
try {
    Remove-AppxPackage -Package $target -AllUsers -ErrorAction Stop
} catch {
    $errList.Add("AllUsers: " + $_.Exception.Message)
    # Fallback para usuário atual
    try {
        Remove-AppxPackage -Package $target -ErrorAction Stop
    } catch {
        $errList.Add("CurrentUser: " + $_.Exception.Message)
    }
}

# 2. Desprovisionamento em nível de imagem/sistema
try {
    Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Where-Object { $_.PackageName -eq $target -or $_.DisplayName -eq $target } | Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue
} catch {}

# 3. Verificação de integridade pós-execução
$stillExists = @(Get-AppxPackage -Name $target -ErrorAction SilentlyContinue).Count -gt 0
if ($stillExists) {
    if ($errList.Count -gt 0) {
        [Console]::Error.WriteLine(($errList -join ' | '))
    } else {
        [Console]::Error.WriteLine("O pacote permanece listado no catálogo AppX do Windows.")
    }
    exit 1
} else {
    exit 0
}
`;

        // ---------------------------------------------------------------
        // 3. EXECUÇÃO CONTROLADA DO POWERSHELL
        // ---------------------------------------------------------------
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', psScript
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', d => stdout += d.toString('utf8'));
        child.stderr.on('data', d => stderr += d.toString('utf8'));

        child.on('close', (code) => {
            const isSuccess = code === 0;
            resolve({
                success: isSuccess,
                exitCode: code,
                error: isSuccess ? null : (stderr.trim() || 'Falha ao desinstalar pacote AppX da Microsoft Store.'),
                lockedProcessesKilled: killResult.KilledProcesses || [],
                stillExists: !isSuccess,
                remainingPath: app.InstallLocation || ''
            });
        });

        child.on('error', (err) => {
            resolve({
                success: false,
                exitCode: 1,
                error: err.message,
                lockedProcessesKilled: killResult.KilledProcesses || [],
                stillExists: true,
                remainingPath: app.InstallLocation || ''
            });
        });
    });
}

// =================================================================
// FUNÇÃO: Execução de Desinstalação de Aplicativos
// Objetivo: Orquestrar desinstalação de entradas órfãs, programas Win32 e apps AppX/MSIX
// Entradas:
//   - 'app' (Objeto com propriedades completas do aplicativo registrado)
//   - 'options' (Objeto de opções: { silent?: boolean })
// Retornos: Promise<Object> com diagnóstico do processo e status de conclusão
// =================================================================
async function runUninstall(app, options = {}) {
    // ---------------------------------------------------------------
    // 1. TRATAMENTO DE ENTRADAS ÓRFÃS (SEM ARQUIVOS EM DISCO)
    // ---------------------------------------------------------------
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

    // ---------------------------------------------------------------
    // 2. ENCERRAMENTO PREVENTIVO DE PROCESSOS ATIVOS
    // ---------------------------------------------------------------
    const killResult = await killActiveLocks(app);

    // ---------------------------------------------------------------
    // 3. ROTEAMENTO ESPECÍFICO PARA APLICATIVOS MICROSOFT STORE (APPX)
    // ---------------------------------------------------------------
    const rawCmd = (app.UninstallString || app.QuietUninstallString || '').toLowerCase();
    const isAppx = rawCmd.includes('remove-appxpackage') || !!app.PackageFamilyName;

    if (isAppx) {
        return await uninstallAppxPackage(app, killResult);
    }

    // ---------------------------------------------------------------
    // 4. DESINSTALAÇÃO CLÁSSICA WIN32 / MSI
    // ---------------------------------------------------------------
    return new Promise((resolve) => {
        const useSilent = options.silent !== false;
        let commandToRun = '';

        if (useSilent && app.QuietUninstallString && app.QuietUninstallString.trim()) {
            commandToRun = app.QuietUninstallString.trim();
        } else if (app.UninstallString && app.UninstallString.trim()) {
            commandToRun = app.UninstallString.trim();
        } else {
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

        // Se requerer elevação e o processo atual for restrito, invoca PowerShell RunAs
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
