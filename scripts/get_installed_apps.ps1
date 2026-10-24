[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

$keys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

$rawApps = Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object { 
    $_.DisplayName -and ($_.DisplayName.Trim() -ne '') -and ($_.SystemComponent -ne 1) -and (-not $_.ParentKeyName)
}

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

function Get-IconBase64($iconPath, $installLoc, $uninstallStr) {
    $candidate = ''
    if ($iconPath) {
        $c = ($iconPath -split ',')[0].Trim('"').Trim()
        if (Test-Path $c) { $candidate = $c }
    }
    if (-not $candidate -and $uninstallStr) {
        $c = ($uninstallStr -split ' ')[0].Trim('"').Trim()
        if ($c -match '\.exe$' -and (Test-Path $c)) { $candidate = $c }
    }
    if (-not $candidate -and $installLoc) {
        $loc = $installLoc.Trim('"').Trim()
        if (Test-Path $loc) {
            $exe = Get-ChildItem -Path $loc -Filter "*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($exe) { $candidate = $exe.FullName }
        }
    }

    if ($candidate -and (Test-Path $candidate)) {
        try {
            $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($candidate)
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

$appList = foreach ($app in $rawApps) {
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
        if (-not $candidateExe -and $app.UninstallString) { $candidateExe = ($app.UninstallString -split ' ')[0].Trim('"').Trim() }
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

    # Arquitetura (32-bit vs 64-bit)
    $arch = if ($app.PSPath -match 'Wow6432Node') { '32-bit' } else { '64-bit' }

    # Site na Internet (URLInfoAbout ou HelpLink)
    $webSite = ''
    if ($app.URLInfoAbout) {
        $webSite = [string]$app.URLInfoAbout
    } elseif ($app.HelpLink) {
        $webSite = [string]$app.HelpLink
    }

    # Ícone oficial em Base64
    $iconB64 = Get-IconBase64 -iconPath $app.DisplayIcon -installLoc $app.InstallLocation -uninstallStr $app.UninstallString

    [PSCustomObject]@{
        Id = [string]$app.PSChildName
        DisplayName = [string]$app.DisplayName.Trim()
        DisplayVersion = [string]$app.DisplayVersion
        Publisher = [string]$app.Publisher
        InstallDate = [string]$app.InstallDate
        EstimatedSizeKb = $sizeKb
        InstallLocation = [string]$app.InstallLocation
        UninstallString = [string]$app.UninstallString
        QuietUninstallString = $bestQuiet
        RawQuietString = [string]$app.QuietUninstallString
        InstallerType = $installerType
        Architecture = $arch
        WebSite = $webSite
        Comments = [string]$app.Comments
        IconBase64 = $iconB64
        RegistryPath = [string]$app.PSPath
    }
}

# Deduplica por DisplayName normalizado
$uniqueApps = $appList | Group-Object { $_.DisplayName.ToLower() } | ForEach-Object { $_.Group[0] } | Sort-Object DisplayName

$uniqueApps | ConvertTo-Json -Depth 4 -Compress
