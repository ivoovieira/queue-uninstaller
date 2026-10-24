const { spawn } = require('child_process');

function runUninstall(app, options = {}) {
    return new Promise((resolve) => {
        const useSilent = options.silent !== false;
        let commandToRun = '';

        if (useSilent && app.QuietUninstallString && app.QuietUninstallString.trim()) {
            commandToRun = app.QuietUninstallString.trim();
        } else if (app.UninstallString && app.UninstallString.trim()) {
            commandToRun = app.UninstallString.trim();
        } else {
            return resolve({
                success: false,
                skipped: true,
                message: 'Nenhum comando de desinstalação disponível para este aplicativo.'
            });
        }

        // Executa via cmd.exe /c "command" para processar argumentos, aspas e executáveis corretamente
        // e aguardar o processo terminar.
        const child = spawn('cmd.exe', ['/s', '/c', commandToRun], {
            windowsHide: false,
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            resolve({
                success: code === 0 || code === 3010, // 3010 é reinicialização pendente (sucesso) no Windows
                exitCode: code,
                command: commandToRun
            });
        });

        child.on('error', (err) => {
            resolve({
                success: false,
                error: err.message,
                command: commandToRun
            });
        });
    });
}

module.exports = { runUninstall };
