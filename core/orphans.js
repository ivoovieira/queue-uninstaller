const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function isElevated() {
    if (process.platform !== 'win32') return true;
    try {
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function scanOrphans(onProgress) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'scan_orphaned_residuals.ps1');

        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';
        let stderrBuffer = '';

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => {
            const chunk = d.toString('utf8');
            stderr += chunk;
            stderrBuffer += chunk;
            const lines = stderrBuffer.split(/\r?\n/);
            stderrBuffer = lines.pop();
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
        });

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
        const tempJsonFile = path.join(os.tmpdir(), `queu_clean_orphans_${Date.now()}.json`);
        const tempResultFile = path.join(os.tmpdir(), `queu_clean_orphans_res_${Date.now()}.json`);

        try {
            fs.writeFileSync(tempJsonFile, JSON.stringify(items || []), 'utf8');
        } catch (e) {
            console.error('Erro ao salvar arquivo temporário de órfãos:', e);
            return resolve({
                Success: false,
                RemovedCount: 0,
                RemovedBytes: 0,
                RemovedItems: [],
                Errors: [`Falha ao salvar dados temporários: ${e.message}`]
            });
        }

        const cleanupTemp = () => {
            try { if (fs.existsSync(tempJsonFile)) fs.unlinkSync(tempJsonFile); } catch (e) {}
            try { if (fs.existsSync(tempResultFile)) fs.unlinkSync(tempResultFile); } catch (e) {}
        };

        const needsElevation = !isElevated() && (items || []).some(item => {
            const p = (item.Path || '').toLowerCase();
            return p.includes('program files') || p.includes('programdata') || p.includes('hkey_local_machine') || p.includes('hklm');
        });

        if (needsElevation) {
            // Cria script temporário .ps1 para evitar problemas de escape de aspas e caminhos com espaço no -ArgumentList do Start-Process
            const tempRunnerFile = path.join(os.tmpdir(), `queu_clean_runner_${Date.now()}.ps1`);
            const runnerScript = `
$ErrorActionPreference = 'Stop'
try {
    & '${scriptPath.replace(/'/g, "''")}' -JsonPath '${tempJsonFile.replace(/'/g, "''")}' -ResultPath '${tempResultFile.replace(/'/g, "''")}'
    exit 0
} catch {
    exit 1
}
`;
            try {
                fs.writeFileSync(tempRunnerFile, runnerScript, 'utf8');
            } catch (e) {
                cleanupTemp();
                return resolve({
                    Success: false,
                    RemovedCount: 0,
                    RemovedBytes: 0,
                    RemovedItems: [],
                    Errors: [`Falha ao criar script runner temporário: ${e.message}`]
                });
            }

            const cmd = `Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${tempRunnerFile}"' -Verb RunAs -Wait`;
            const child = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true });

            child.on('close', (code) => {
                try { if (fs.existsSync(tempRunnerFile)) fs.unlinkSync(tempRunnerFile); } catch (e) {}

                try {
                    if (fs.existsSync(tempResultFile)) {
                        const raw = fs.readFileSync(tempResultFile, 'utf8');
                        cleanupTemp();
                        const parsed = JSON.parse(raw);
                        return resolve(parsed);
                    }
                } catch (err) {
                    console.error('Erro ao ler resultado de limpeza elevada de órfãos:', err);
                }
                cleanupTemp();
                if (code !== 0) {
                    resolve({
                        Success: false,
                        RemovedCount: 0,
                        RemovedBytes: 0,
                        RemovedItems: [],
                        Errors: ['Operação de limpeza cancelada ou permissão de Administrador negada no UAC.']
                    });
                } else {
                    resolve({
                        Success: false,
                        RemovedCount: 0,
                        RemovedBytes: 0,
                        RemovedItems: [],
                        Errors: ['Falha ao concluir a exclusão de arquivos protegidos.']
                    });
                }
            });

            child.on('error', (err) => {
                try { if (fs.existsSync(tempRunnerFile)) fs.unlinkSync(tempRunnerFile); } catch (e) {}
                cleanupTemp();
                resolve({
                    Success: false,
                    RemovedCount: 0,
                    RemovedBytes: 0,
                    RemovedItems: [],
                    Errors: [err.message]
                });
            });
            return;
        }

        // Execução direta padrão se já for Administrador ou se não envolver pastas de sistema
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-JsonPath', tempJsonFile,
            '-ResultPath', tempResultFile
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('close', (code) => {
            try {
                if (fs.existsSync(tempResultFile)) {
                    const raw = fs.readFileSync(tempResultFile, 'utf8');
                    cleanupTemp();
                    return resolve(JSON.parse(raw));
                }
                const jsonStart = stdout.indexOf('{');
                if (jsonStart !== -1) {
                    cleanupTemp();
                    const result = JSON.parse(stdout.substring(jsonStart));
                    return resolve(result);
                }
            } catch (err) {
                console.error('Erro no parser de limpeza de órfãos:', err);
            }
            cleanupTemp();
            resolve({
                Success: false,
                RemovedCount: 0,
                RemovedBytes: 0,
                RemovedItems: [],
                Errors: [stderr || 'Falha ao limpar resíduos órfãos']
            });
        });

        child.on('error', (err) => {
            cleanupTemp();
            resolve({
                Success: false,
                RemovedCount: 0,
                RemovedBytes: 0,
                RemovedItems: [],
                Errors: [err.message]
            });
        });
    });
}

module.exports = { scanOrphans, cleanOrphans };
