[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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
            if ($u -match '(?i)/x') {
                return "$u /qn /norestart"
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
    }

    $iconPath = ''
    if ($app.DisplayIcon) {
        $rawIcon = ($app.DisplayIcon -split ',')[0].Trim('"')
        if (Test-Path $rawIcon) {
            $iconPath = $rawIcon
        }
    }

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
        DisplayIcon = $iconPath
        RegistryPath = [string]$app.PSPath
    }
}

# Deduplica por DisplayName normalizado
$uniqueApps = $appList | Group-Object { $_.DisplayName.ToLower() } | ForEach-Object { $_.Group[0] } | Sort-Object DisplayName

$uniqueApps | ConvertTo-Json -Depth 4 -Compress
