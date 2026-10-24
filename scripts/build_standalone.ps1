$distDir = "dist\QueuUninstaller-win32-x64"
if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

Write-Host "Copiando binários do Electron..."
Copy-Item -Path "node_modules\electron\dist\*" -Destination $distDir -Recurse -Force
Rename-Item -Path "$distDir\electron.exe" -NewName "QueuUninstaller.exe" -Force

$appDir = "$distDir\resources\app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

Write-Host "Copiando arquivos da aplicação Queu Uninstaller..."
Copy-Item -Path "package.json", "main.js", "preload.js", "server.js", "icon.ico", "icon.png" -Destination $appDir -Force
Copy-Item -Path "core", "scripts", "src" -Destination $appDir -Recurse -Force

# Compacta usando 7-Zip para criar um arquivo zip ultra comprimido
$zipPath = "dist\QueuUninstaller-v1.1.0-Windows-x64.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

Write-Host "Compactando com 7-Zip..."
& "C:\Program Files\7-Zip\7z.exe" a -tzip -mx=9 $zipPath ".\$distDir\*" | Out-Null

$zipItem = Get-Item $zipPath
Write-Host "Arquivo final pronto: $($zipItem.FullName) - Tamanho: $([math]::Round($zipItem.Length / 1MB, 2)) MB"
