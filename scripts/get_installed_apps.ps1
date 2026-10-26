[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 2; step = "Iniciando varredura do sistema..." } | ConvertTo-Json -Compress))

Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

# Inicialização de COM Object para atalhos (.lnk)
$wscriptShell = $null
try {
    $wscriptShell = New-Object -ComObject WScript.Shell
} catch {}

# Pré-indexação rápida de atalhos do Menu Iniciar e Desktop
$shortcutSearchPaths = @(
    'C:\ProgramData\Microsoft\Windows\Start Menu\Programs',
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    'C:\Users\Public\Desktop',
    "$env:USERPROFILE\Desktop"
) | Where-Object { Test-Path $_ }

$allShortcuts = @()
foreach ($sp in $shortcutSearchPaths) {
    $allShortcuts += Get-ChildItem -Path $sp -Filter "*.lnk" -Recurse -File -ErrorAction SilentlyContinue
}

# Detecção do caminho de ícones de Jogos da Steam
$steamGamesPath = ''
try {
    $sReg = Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue
    if ($sReg -and $sReg.SteamPath) {
        $steamGamesPath = Join-Path $sReg.SteamPath 'steam\games'
    }
} catch {}
if (-not $steamGamesPath -or -not (Test-Path $steamGamesPath)) {
    if (Test-Path 'C:\Program Files (x86)\Steam\steam\games') {
        $steamGamesPath = 'C:\Program Files (x86)\Steam\steam\games'
    } elseif (Test-Path 'C:\Program Files\Steam\steam\games') {
        $steamGamesPath = 'C:\Program Files\Steam\steam\games'
    }
}

$keys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

$rawApps = @(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object { 
    $_.DisplayName -and ($_.DisplayName.Trim() -ne '') -and (-not $_.ParentKeyName) -and (
        ($_.SystemComponent -ne 1) -or 
        ($_.DisplayName -match '(?i)(Windows Subsystem for Linux|WSL|PowerToys|Windows Subsystem for Android)')
    )
})

$totalApps = $rawApps.Count
[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 10; step = "Lendo Registro: $totalApps programas encontrados..." } | ConvertTo-Json -Compress))

function Detect-InstallerType($uninstallStr, $quietStr) {
    $str = "$uninstallStr $quietStr"
    if ($str -match 'msiexec\.exe') { return 'MSI' }
    if ($str -match 'unins\d+\.exe') { return 'InnoSetup' }
    if ($str -match 'uninstall\.exe') { return 'NSIS' }
    if ($str -match 'setup\.exe.*-runfromtemp') { return 'InstallShield' }
    if ($str -match 'Update\.exe.*--uninstall') { return 'Squirrel' }
    return 'Generic'
}

function Get-OptimizedQuietString($uninstallStr, $quietStr, $installerType) {
    if ($quietStr -and ($quietStr.Trim() -ne '')) {
        return $quietStr.Trim()
    }
    if (-not $uninstallStr) { return '' }
    $u = $uninstallStr.Trim()

    switch ($installerType) {
        'MSI' {
            if ($u -match '(?i)msiexec(\.exe)?\s+/x\s*(\{[^}]+\})') {
                return "MsiExec.exe /X$($Matches[2]) /qn /norestart"
            }
            return "$u /qn /norestart"
        }
        'InnoSetup' {
            return "$u /SILENT /VERYSILENT /SUPPRESSMSGBOXES /NORESTART"
        }
        'NSIS' {
            return "$u /S"
        }
        'InstallShield' {
            return "$u /s /v/qn"
        }
        default {
            return ''
        }
    }
}

function Get-IconBase64($iconPath, $installLoc, $uninstallStr, $displayName, $appId) {
    $candidate = ''

    # 1. DisplayIcon direto informado no Registro
    if ($iconPath) {
        $clean = $iconPath.Trim()
        if ($clean -match '^\s*"([^"]+)"') {
            $clean = $Matches[1]
        } elseif ($clean -match '^([^,]+)') {
            $clean = $Matches[1].Trim('"').Trim()
        }
        $clean = [Environment]::ExpandEnvironmentVariables($clean)
        if (Test-Path $clean) { $candidate = $clean }
    }

    # 2. Suporte nativo a Jogos Steam (AppID)
    if (-not $candidate -and $steamGamesPath) {
        $steamAppId = ''
        if ($appId -match 'Steam App (\d+)') {
            $steamAppId = $Matches[1]
        } elseif ($uninstallStr -match 'steam://uninstall/(\d+)') {
            $steamAppId = $Matches[1]
        }
        if ($steamAppId) {
            $steamIco = Join-Path $steamGamesPath "$steamAppId.ico"
            if (Test-Path $steamIco) { $candidate = $steamIco }
        }
    }

    # Suporte específico a Windows Subsystem for Linux (WSL / WSL Settings)
    if (-not $candidate -and ($displayName -match '(?i)(Windows Subsystem for Linux|WSL)')) {
        $wslInstallerIco = "C:\WINDOWS\Installer\$appId\wsl.ico"
        if (Test-Path $wslInstallerIco) {
            $candidate = $wslInstallerIco
        } elseif (Test-Path "C:\Program Files\WSL\wslsettings\wslsettings.exe") {
            $candidate = "C:\Program Files\WSL\wslsettings\wslsettings.exe"
        } elseif (Test-Path "C:\Program Files\WSL\wsl.exe") {
            $candidate = "C:\Program Files\WSL\wsl.exe"
        }
    }

    # 3. Parsing Robusto com Regex em UninstallString (Evita quebras em caminhos com espaços)
    $uninstallerCandidate = ''
    if (-not $candidate -and $uninstallStr) {
        $uClean = $uninstallStr.Trim()
        $candExe = ''
        if ($uClean -match '^\s*"([^"]+?\.exe)"') {
            $candExe = $Matches[1]
        } elseif ($uClean -match '^\s*([^\s"]+?\.exe)') {
            $candExe = $Matches[1]
        }
        if ($candExe) {
            $candExe = [Environment]::ExpandEnvironmentVariables($candExe)
            if ((Test-Path $candExe) -and ($candExe -notmatch '(?i)msiexec\.exe')) {
                if ($candExe -match '(?i)(unins\w*|uninstall|setup)\.exe$') {
                    $uninstallerCandidate = $candExe
                } else {
                    $candidate = $candExe
                }
            }
        }
    }

    # 4. Varredura Recursiva Inteligente em InstallLocation (Jogos, Launchers e Apps em subpastas)
    if (-not $candidate -and $installLoc) {
        $loc = [Environment]::ExpandEnvironmentVariables($installLoc.Trim('"').Trim())
        if (Test-Path $loc) {
            $rootExes = Get-ChildItem -Path $loc -Filter "*.exe" -File -ErrorAction SilentlyContinue
            $allExes = if ($rootExes -and $rootExes.Count -gt 0) {
                $rootExes
            } else {
                Get-ChildItem -Path $loc -Filter "*.exe" -Recurse -Depth 3 -File -ErrorAction SilentlyContinue
            }

            if ($allExes) {
                $blacklist = '(?i)^(unins.*|uninstall.*|setup.*|installer.*|update.*|updater.*|patch.*|.*crash.*|.*helper.*|.*service.*|.*daemon.*|vcredist.*|dxsetup.*|dotnet.*|node.*|elevation_service.*)$'
                $validExes = $allExes | Where-Object { $_.BaseName -notmatch $blacklist }
                if (-not $validExes) { $validExes = $allExes }

                if ($validExes) {
                    $normName = ($displayName -replace '[^\w]', '').ToLower()
                    $words = ($displayName -split '[\s\-_]+') | Where-Object { $_.Length -ge 3 } | ForEach-Object { $_.ToLower() }

                    $bestExe = $null
                    $bestScore = -1

                    foreach ($exe in $validExes) {
                        $score = 0
                        $base = $exe.BaseName.ToLower()
                        $normBase = ($base -replace '[^\w]', '')

                        if ($normBase -and ($normBase -eq $normName)) {
                            $score += 1000
                        } elseif ($normName -and ($normName.Contains($normBase) -or $normBase.Contains($normName))) {
                            $score += 500
                        }

                        foreach ($w in $words) {
                            if ($base.Contains($w)) {
                                $score += 100
                            }
                        }

                        if ($exe.Length -gt 1MB) { $score += 20 }
                        if ($exe.Length -gt 10MB) { $score += 20 }

                        if ($score -gt $bestScore) {
                            $bestScore = $score
                            $bestExe = $exe
                        }
                    }

                    if ($bestExe) {
                        $candidate = $bestExe.FullName
                    }
                }
            }
        }
    }

    # Se apenas desinstalador foi localizado, verificar outros executáveis na mesma pasta
    if (-not $candidate -and $uninstallerCandidate) {
        $parent = Split-Path -Path $uninstallerCandidate -Parent
        if ($parent -and (Test-Path $parent)) {
            $nearbyExes = Get-ChildItem -Path $parent -Filter "*.exe" -File -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -ne $uninstallerCandidate -and $_.BaseName -notmatch '(?i)^(unins.*|uninstall.*)$' }
            if ($nearbyExes) {
                $candidate = ($nearbyExes | Sort-Object Length -Descending | Select-Object -First 1).FullName
            } else {
                $candidate = $uninstallerCandidate
            }
        } else {
            $candidate = $uninstallerCandidate
        }
    }

    # 5. Fallback em App Paths do Registro (Google Chrome, VLC, WinRAR, Python, Node, etc.)
    if (-not $candidate -and $displayName) {
        $candNames = @()
        $cleanWord = ($displayName -replace '(?i)\s*(release|version|x64|x86|64-bit|32-bit|\d+(\.\d+)*).*', '').Trim()
        $firstWord = ($cleanWord -split '[\s\-_]+')[0]
        if ($firstWord) { $candNames += "$firstWord.exe" }
        $noSpaces = ($cleanWord -replace '[^\w]', '')
        if ($noSpaces -and $noSpaces -ne $firstWord) { $candNames += "$noSpaces.exe" }

        # Mapeamentos diretos comuns
        if ($displayName -match '(?i)chrome') { $candNames += 'chrome.exe' }
        if ($displayName -match '(?i)node\.?js') { $candNames += 'node.exe' }
        if ($displayName -match '(?i)python.*launcher') {
            if (Test-Path 'C:\Windows\py.exe') { $candidate = 'C:\Windows\py.exe' }
        } elseif ($displayName -match '(?i)python') {
            $candNames += 'python.exe'
            $candNames += 'py.exe'
        }
        if ($displayName -match '(?i)putty') { $candNames += 'putty.exe' }
        if ($displayName -match '(?i)vlc') { $candNames += 'vlc.exe' }
        if ($displayName -match '(?i)winrar') { $candNames += 'winrar.exe' }

        if (-not $candidate) {
            foreach ($cn in ($candNames | Select-Object -Unique)) {
                foreach ($hive in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths')) {
                    $regKey = Join-Path $hive $cn
                    if (Test-Path $regKey) {
                        $target = (Get-ItemProperty -Path $regKey -ErrorAction SilentlyContinue).'(default)'
                        if ($target) {
                            $target = [Environment]::ExpandEnvironmentVariables($target.Trim('"'))
                            if (Test-Path $target) {
                                $candidate = $target
                                break
                            }
                        }
                    }
                }
                if ($candidate) { break }
            }
        }
    }

    # 6. Fallback nos Atalhos do Menu Iniciar e Desktop (.lnk)
    if (-not $candidate -and $displayName -and $wscriptShell -and $allShortcuts.Count -gt 0) {
        $cleanName = ($displayName -replace '(?i)\s*(release|version|x64|x86|64-bit|32-bit|\d+(\.\d+)*).*', '').Trim().ToLower()
        $normClean = ($cleanName -replace '[^\w]', '')

        $matchedScs = $allShortcuts | Where-Object {
            $base = $_.BaseName.ToLower()
            $baseNorm = ($base -replace '[^\w]', '')
            ($baseNorm -and $normClean -and ($baseNorm -eq $normClean)) -or 
            ($base.Length -ge 3 -and $cleanName.Contains($base)) -or 
            ($cleanName.Length -ge 3 -and $base.Contains($cleanName))
        } | Sort-Object {
            $base = $_.BaseName.ToLower()
            if ($base -eq $cleanName) { 0 }
            elseif ($base -notmatch '(?i)(manual|help|site|uninstall|readme|documentation)') { 1 }
            else { 2 }
        }

        foreach ($sc in $matchedScs) {
            try {
                $scObj = $wscriptShell.CreateShortcut($sc.FullName)
                $tPath = $scObj.TargetPath
                if ($tPath) {
                    $tPath = [Environment]::ExpandEnvironmentVariables($tPath.Trim('"'))
                    if ((Test-Path $tPath) -and ($tPath -match '\.exe$')) {
                        $candidate = $tPath
                        break
                    }
                }
                if ($scObj.IconLocation) {
                    $iconLoc = ($scObj.IconLocation -split ',')[0].Trim('"')
                    $iconLoc = [Environment]::ExpandEnvironmentVariables($iconLoc)
                    if (Test-Path $iconLoc) {
                        $candidate = $iconLoc
                        break
                    }
                }
            } catch {}
        }
    }

    # 7. Fallback Oficial para Instaladores MSI (Windows Installer)
    if (-not $candidate -and ($uninstallStr -match '(?i)msiexec\.exe' -or $appId -match '^\{[0-9A-Fa-f\-]{36}\}')) {
        # Verifica se o Windows Installer cacheou um ícone específico em C:\Windows\Installer
        if (Test-Path "C:\Windows\Installer\$appId") {
            $msiIcon = Get-ChildItem -Path "C:\Windows\Installer\$appId" -Filter "*.ico" -File -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($msiIcon) { $candidate = $msiIcon.FullName }
        }
        if (-not $candidate -and (Test-Path 'C:\Windows\System32\msiexec.exe')) {
            $candidate = 'C:\Windows\System32\msiexec.exe'
        }
    }

    # 8. Extração do Ícone para PNG Base64
    if ($candidate -and (Test-Path $candidate)) {
        try {
            $ico = $null
            if ($candidate -match '\.ico$') {
                $ico = New-Object System.Drawing.Icon($candidate)
            } else {
                $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($candidate)
            }
            if ($ico) {
                $bmp = $ico.ToBitmap()
                $ms = New-Object System.IO.MemoryStream
                $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                $b64 = [Convert]::ToBase64String($ms.ToArray())
                $ms.Dispose()
                $ico.Dispose()
                $bmp.Dispose()
                return "data:image/png;base64,$b64"
            }
        } catch {}
    }
    return ''
}

$current = 0
$appList = foreach ($app in $rawApps) {
    $current++
    $pct = [math]::Round(10 + (($current / [math]::Max($totalApps, 1)) * 80))
    $appName = if ($app.DisplayName) { $app.DisplayName.Trim() } else { "Aplicativo" }
    [Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = $pct; step = "Examinando $appName ($current de $totalApps)..." } | ConvertTo-Json -Compress))

    $installerType = Detect-InstallerType -uninstallStr $app.UninstallString -quietStr $app.QuietUninstallString
    $bestQuiet = Get-OptimizedQuietString -uninstallStr $app.UninstallString -quietStr $app.QuietUninstallString -installerType $installerType

    $sizeKb = 0
    if ($app.EstimatedSize) {
        $sizeKb = [int64]$app.EstimatedSize
    } elseif ($app.InstallLocation -and (Test-Path $app.InstallLocation)) {
        try {
            $folderSize = (Get-ChildItem -Path $app.InstallLocation -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            if ($folderSize) { $sizeKb = [int64]($folderSize / 1024) }
        } catch {}
    } else {
        # Fallback inteligente: tentar inferir pasta pelo executável de DisplayIcon ou UninstallString
        $candidateExe = ""
        if ($app.DisplayIcon) { $candidateExe = ($app.DisplayIcon -split ',')[0].Trim('"').Trim() }
        if (-not $candidateExe -and $app.UninstallString) {
            if ($app.UninstallString -match '^\s*"([^"]+?\.exe)"') {
                $candidateExe = $Matches[1]
            } elseif ($app.UninstallString -match '^\s*([^\s"]+?\.exe)') {
                $candidateExe = $Matches[1]
            }
        }
        if ($candidateExe -and (Test-Path $candidateExe) -and ($candidateExe -match '\.exe$')) {
            $parentDir = Split-Path -Path $candidateExe -Parent
            if ($parentDir -and (Test-Path $parentDir)) {
                $normParent = $parentDir.ToLower()
                if ($normParent -notmatch '^c:\\windows' -and $normParent -ne 'c:\program files' -and $normParent -ne 'c:\program files (x86)' -and $normParent -ne "$env:LOCALAPPDATA\programs".ToLower()) {
                    try {
                        $folderSize = (Get-ChildItem -Path $parentDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                        if ($folderSize) { $sizeKb = [int64]($folderSize / 1024) }
                    } catch {}
                }
            }
        }
    }

    # Verificação de Entrada Órfã (Arquivos e pastas ausentes no disco, restando apenas a chave no Registro)
    $hasValidLocation = $false
    if ($app.InstallLocation) {
        $cleanLoc = [Environment]::ExpandEnvironmentVariables($app.InstallLocation.Trim('"').Trim())
        if ($cleanLoc -and (Test-Path $cleanLoc)) {
            $hasValidLocation = $true
        }
    }

    $hasValidUninstallExe = $false
    if ($candidateExe) {
        if (Test-Path $candidateExe) {
            $hasValidUninstallExe = $true
        }
    } elseif ($app.UninstallString) {
        $uStr = $app.UninstallString.Trim()
        $extractedExe = ''
        if ($uStr -match '^\s*"([^"]+?\.exe)"') {
            $extractedExe = $Matches[1]
        } elseif ($uStr -match '^\s*([^\s"]+?\.exe)') {
            $extractedExe = $Matches[1]
        }
        if ($extractedExe -and ($extractedExe -notmatch '(?i)msiexec\.exe')) {
            $extractedExe = [Environment]::ExpandEnvironmentVariables($extractedExe)
            if (Test-Path $extractedExe) {
                $hasValidUninstallExe = $true
            }
        }
    }

    $hasValidDisplayExe = $false
    if ($app.DisplayIcon) {
        $cleanIconPath = ($app.DisplayIcon -split ',')[0].Trim('"').Trim()
        $cleanIconPath = [Environment]::ExpandEnvironmentVariables($cleanIconPath)
        if ($cleanIconPath -and (Test-Path $cleanIconPath) -and ($cleanIconPath -notmatch '(?i)msiexec\.exe')) {
            $hasValidDisplayExe = $true
        }
    }

    $isMsi = ($installerType -eq 'MSI' -or ($app.UninstallString -match '(?i)msiexec\.exe'))

    $isOrphan = $false
    if (-not $isMsi) {
        # Se InstallLocation foi registrado mas a pasta não existe no disco, E o desinstalador não existe no disco
        if ($app.InstallLocation -and (-not $hasValidLocation) -and (-not $hasValidUninstallExe)) {
            $isOrphan = $true
        } elseif ((-not $hasValidLocation) -and (-not $hasValidUninstallExe) -and (-not $hasValidDisplayExe)) {
            # Se não tem pasta válida, não tem desinstalador no disco e não tem display icon no disco
            $isOrphan = $true
        }
    }

    # Arquitetura (32-bit vs 64-bit)
    $arch = if ($app.PSPath -match 'Wow6432Node') { '32-bit' } else { '64-bit' }

    # Site na Internet (URLInfoAbout ou HelpLink)
    $webSite = ''
    if ($app.URLInfoAbout) {
        $webSite = [string]$app.URLInfoAbout
    } elseif ($app.HelpLink) {
        $webSite = [string]$app.HelpLink
    }

    # Ícone oficial em Base64 com cascata de prioridades
    $iconB64 = Get-IconBase64 -iconPath $app.DisplayIcon -installLoc $app.InstallLocation -uninstallStr $app.UninstallString -displayName $app.DisplayName -appId $app.PSChildName

    $finalDisplayName = [string]$app.DisplayName.Trim()
    $finalComments = [string]$app.Comments
    $finalInstallLoc = [string]$app.InstallLocation

    if ($finalDisplayName -match '(?i)^Windows Subsystem for Linux') {
        $finalDisplayName = 'Windows Subsystem for Linux (WSL / WSL Settings)'
        $finalComments = "WSL, WSL Settings, Linux, Configurações do WSL, Subsistema do Windows para Linux $finalComments".Trim()
        if (-not $finalInstallLoc -and (Test-Path "C:\Program Files\WSL")) {
            $finalInstallLoc = "C:\Program Files\WSL"
        }
    }

    [PSCustomObject]@{
        Id = [string]$app.PSChildName
        DisplayName = $finalDisplayName
        DisplayVersion = [string]$app.DisplayVersion
        Publisher = [string]$app.Publisher
        InstallDate = [string]$app.InstallDate
        EstimatedSizeKb = $sizeKb
        InstallLocation = $finalInstallLoc
        UninstallString = [string]$app.UninstallString
        QuietUninstallString = $bestQuiet
        RawQuietString = [string]$app.QuietUninstallString
        InstallerType = $installerType
        Architecture = $arch
        WebSite = $webSite
        Comments = $finalComments
        IconBase64 = $iconB64
        RegistryPath = [string]$app.PSPath
        IsOrphan = [bool]$isOrphan
    }
}

# Deduplica por DisplayName normalizado
[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 95; step = "Finalizando compilação da lista..." } | ConvertTo-Json -Compress))
$uniqueApps = $appList | Group-Object { $_.DisplayName.ToLower() } | ForEach-Object { $_.Group[0] } | Sort-Object DisplayName
[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 100; step = "Concluído!" } | ConvertTo-Json -Compress))

$uniqueApps | ConvertTo-Json -Depth 4 -Compress
