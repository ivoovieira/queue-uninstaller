const { exec } = require('child_process');
const path = require('path');

function checkForUpdates() {
    return new Promise((resolve) => {
        const repoDir = path.join(__dirname, '..');
        // Executa git fetch para sincronizar referências remotas silenciosamente
        exec('git fetch origin main', { cwd: repoDir }, (fetchErr) => {
            if (fetchErr) {
                return resolve({ hasUpdate: false, error: fetchErr.message });
            }

            // Compara commits
            exec('git rev-parse HEAD && git rev-parse origin/main', { cwd: repoDir }, (parseErr, stdout) => {
                if (parseErr) {
                    return resolve({ hasUpdate: false, error: parseErr.message });
                }

                const lines = stdout.trim().split(/\r?\n/).map(l => l.trim());
                if (lines.length >= 2) {
                    const localCommit = lines[0];
                    const remoteCommit = lines[1];
                    const hasUpdate = (localCommit !== remoteCommit);
                    resolve({
                        hasUpdate,
                        localCommit: localCommit.substring(0, 7),
                        remoteCommit: remoteCommit.substring(0, 7)
                    });
                } else {
                    resolve({ hasUpdate: false });
                }
            });
        });
    });
}

function applyUpdate() {
    return new Promise((resolve) => {
        const repoDir = path.join(__dirname, '..');
        exec('git pull origin main', { cwd: repoDir }, (err, stdout, stderr) => {
            if (err) {
                return resolve({ success: false, message: stderr || err.message });
            }
            resolve({ success: true, message: stdout });
        });
    });
}

module.exports = { checkForUpdates, applyUpdate };
