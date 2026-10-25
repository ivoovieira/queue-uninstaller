const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-JsonPath', tempJsonFile
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        child.on('close', (code) => {
            try {
                if (fs.existsSync(tempJsonFile)) {
                    fs.unlinkSync(tempJsonFile);
                }
            } catch (e) {}

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
