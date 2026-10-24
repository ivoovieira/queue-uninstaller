const https = require('https');
const fs = require('fs');
const { spawnSync } = require('child_process');

const input = 'protocol=https\nhost=github.com\n\n';
const res = spawnSync('git', ['credential', 'fill'], { input, encoding: 'utf8' });
const match = res.stdout.match(/password=(.*)/);
if (!match) process.exit(1);
const token = match[1].trim();

// Cria a nova Release v1.2.0 com o executavel unico oficial
const releaseData = JSON.stringify({
    tag_name: 'v1.2.0',
    target_commitish: 'main',
    name: 'Queu Uninstaller v1.2.0 (Executável Único Oficial)',
    body: '## 🚀 Queu Uninstaller v1.2.0\n\n### ✨ Novidades desta versão:\n- **Executável Único Oficial (`QueuUninstaller-Setup.exe`)**: Baixe apenas 1 arquivo executável e execute direto sem precisar extrair pastas ou arquivos soltos!\n- **Suporte a Windows Apps (Microsoft Store)**: Liste e remova aplicativos nativos da Store do Windows.\n- **Interface Limpa & Sóbria**: Removidas cores fortes e fundos coloridos, tipografia branca limpa e elegante.\n- **Painel de Opções Funcional**: Configurações salvas e aplicadas em tempo real.\n\n### 📦 Download:\nBaixe abaixo o arquivo **`QueuUninstaller-Setup.exe`** e dê dois cliques para iniciar!',
    draft: false,
    prerelease: false
});

const req = https.request({
    hostname: 'api.github.com',
    path: '/repos/ivoovieira/queue-uninstaller/releases',
    method: 'POST',
    headers: {
        'User-Agent': 'Node-GitHub',
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(releaseData)
    }
}, (resp) => {
    let body = '';
    resp.on('data', c => body += c);
    resp.on('end', async () => {
        const json = JSON.parse(body);
        if (json.upload_url) {
            console.log('RELEASE v1.2.0 CRIADA:', json.html_url);
            const uploadUrl = json.upload_url.replace('{?name,label}', '');
            console.log('Enviando executavel unico QueuUninstaller-Setup.exe (106 MB)...');
            await uploadAsset(uploadUrl, 'dist/QueuUninstaller-Setup.exe', 'QueuUninstaller-Setup.exe', 'application/vnd.microsoft.portable-executable', token);
            console.log('UPLOAD FINALIZADO COM SUCESSO ABSOLUTO!');
        } else {
            console.error('Erro:', json);
        }
    });
});

req.write(releaseData);
req.end();

function uploadAsset(uploadUrl, filePath, filename, mimeType, authToken) {
    return new Promise((resolve, reject) => {
        const stat = fs.statSync(filePath);
        const urlObj = new URL(`${uploadUrl}?name=${filename}`);

        const upReq = https.request({
            hostname: urlObj.hostname,
            path: `${urlObj.pathname}${urlObj.search}`,
            method: 'POST',
            headers: {
                'User-Agent': 'Node-GitHub',
                'Authorization': `token ${authToken}`,
                'Content-Type': mimeType,
                'Content-Length': stat.size
            }
        }, (upResp) => {
            let upBody = '';
            upResp.on('data', c => upBody += c);
            upResp.on('end', () => {
                console.log(`Upload finalizado! Status HTTP: ${upResp.statusCode}`);
                resolve();
            });
        });

        upReq.on('error', reject);
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(upReq);
    });
}
