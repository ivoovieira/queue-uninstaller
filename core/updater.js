const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { spawn, exec } = require('child_process');

const pkgPath = path.join(__dirname, '..', 'package.json');
let pkg = { version: '1.5.2' };
try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
} catch (e) {}

const CURRENT_VERSION = pkg.version || '1.5.2';
const GITHUB_REPO = 'ivoovieira/queue-uninstaller';

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'QueuUninstaller-App',
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return httpGetJson(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return resolve(null);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on('error', (e) => resolve(null));
        req.setTimeout(8000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const req = https.get(url, {
            headers: { 'User-Agent': 'QueuUninstaller-App' }
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                return reject(new Error(`Falha no download. Código HTTP: ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        });
        req.on('error', (err) => {
            try { fs.unlinkSync(destPath); } catch (e) {}
            reject(err);
        });
        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error('Tempo limite de download esgotado.'));
        });
    });
}

function compareVersions(v1, v2) {
    // Normaliza v1.2.1 para [1, 2, 1]
    const cleanV1 = (v1 || '').replace(/^v/i, '').split('.').map(Number);
    const cleanV2 = (v2 || '').replace(/^v/i, '').split('.').map(Number);
    for (let i = 0; i < Math.max(cleanV1.length, cleanV2.length); i++) {
        const num1 = cleanV1[i] || 0;
        const num2 = cleanV2[i] || 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

async function checkForUpdates() {
    try {
        // 1. Tentar checar último release oficial no GitHub
        const release = await httpGetJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        let hasUpdate = false;
        let remoteVersion = CURRENT_VERSION;
        let downloadUrl = '';
        let releaseNotes = '';

        if (release && release.tag_name) {
            remoteVersion = release.tag_name.replace(/^v/i, '');
            if (compareVersions(remoteVersion, CURRENT_VERSION) > 0) {
                hasUpdate = true;
                releaseNotes = release.body || '';
                const exeAsset = (release.assets || []).find(a => a.name.endsWith('.exe'));
                if (exeAsset) {
                    downloadUrl = exeAsset.browser_download_url;
                }
            }
        }

        // 2. Se não houver release mais recente, checar se houve commit novo na branch main
        let latestCommitSha = '';
        if (!hasUpdate) {
            const commit = await httpGetJson(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`);
            if (commit && commit.sha) {
                latestCommitSha = commit.sha.substring(0, 7);
            }
        }

        return {
            hasUpdate,
            currentVersion: CURRENT_VERSION,
            remoteVersion: hasUpdate ? `v${remoteVersion}` : `v${CURRENT_VERSION}`,
            latestCommit: latestCommitSha,
            releaseNotes,
            downloadUrl
        };
    } catch (e) {
        return {
            hasUpdate: false,
            currentVersion: CURRENT_VERSION,
            error: e.message
        };
    }
}

async function applyUpdate() {
    const updateInfo = await checkForUpdates();
    if (!updateInfo.hasUpdate && !updateInfo.downloadUrl) {
        // Se estiver em ambiente local com .git, tenta git pull
        const repoDir = path.join(__dirname, '..');
        if (fs.existsSync(path.join(repoDir, '.git'))) {
            return new Promise((resolve) => {
                exec('git pull origin main', { cwd: repoDir }, (err, stdout, stderr) => {
                    if (err) return resolve({ success: false, message: stderr || err.message });
                    resolve({ success: true, message: 'Repositório sincronizado com sucesso.' });
                });
            });
        }
        return { success: false, message: 'Nenhuma atualização disponível para download.' };
    }

    if (updateInfo.downloadUrl) {
        try {
            const tempInstaller = path.join(os.tmpdir(), `QueuUninstaller-Setup-${Date.now()}.exe`);
            await downloadFile(updateInfo.downloadUrl, tempInstaller);

            // Dispara o instalador desanexado do processo atual
            const child = spawn(tempInstaller, [], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();

            return {
                success: true,
                isInstaller: true,
                message: 'Instalador baixado com sucesso! O aplicativo será fechado para aplicar a atualização.'
            };
        } catch (err) {
            return { success: false, message: `Erro ao baixar instalador: ${err.message}` };
        }
    }

    return { success: false, message: 'Nenhum link de download disponível no momento.' };
}

module.exports = { checkForUpdates, applyUpdate, CURRENT_VERSION };
