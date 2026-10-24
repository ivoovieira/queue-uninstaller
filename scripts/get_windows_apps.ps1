[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rawApps = try {
    Get-AppxPackage -AllUsers -ErrorAction Stop | Where-Object { (-not $_.IsFramework) -and (-not $_.NonRemovable) }
} catch {
    Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { (-not $_.IsFramework) -and (-not $_.NonRemovable) }
}

$appList = foreach ($a in $rawApps) {
    if (-not $a.Name -or ($a.Name -match '^Microsoft\.VCLibs') -or ($a.Name -match '^Microsoft\.UI\.Xaml') -or ($a.Name -match '^Microsoft\.NET')) {
        continue
    }

    # Nome amigável robusto: ignora sufixos de versão numérica (ex: .1.0, .2) e códigos de idioma
    $rawName = [string]$a.Name
    $clean = $rawName -replace '(?:\.\d+)+$', ''
    $clean = $clean -replace '\.[a-zA-Z]{2}(-[a-zA-Z]{2,4})?$', ''
    $clean = $clean -replace '(?:\.\d+)+$', ''
    if ($clean -match '^(?:MicrosoftCorporationII|Microsoft|Windows|SpotifyAB|AppleInc)\.(.+)$') {
        $clean = $Matches[1]
    }
    $friendlyName = ($clean -replace '[\._]', ' ').Trim()
    if (-not $friendlyName -or $friendlyName -match '^\d+$') {
        $friendlyName = ($rawName -replace '(?:\.\d+)+$', '')
    }

    # Tamanho da pasta
    $sizeKb = 0
    if ($a.InstallLocation -and (Test-Path $a.InstallLocation)) {
        try {
            $fSize = (Get-ChildItem -Path $a.InstallLocation -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            if ($fSize) { $sizeKb = [int64]($fSize / 1024) }
        } catch {}
    }

    $pub = [string]($a.Publisher -replace 'CN=|,.*', '')
    if (-not $pub) { $pub = "Microsoft Corporation" }

    [PSCustomObject]@{
        Id = [string]$a.PackageFullName
        DisplayName = $friendlyName
        DisplayVersion = [string]$a.Version
        Publisher = $pub
        InstallDate = ""
        EstimatedSizeKb = $sizeKb
        InstallLocation = [string]$a.InstallLocation
        UninstallString = "powershell -NoProfile -Command Remove-AppxPackage -Package $($a.PackageFullName)"
        QuietUninstallString = "powershell -NoProfile -Command Remove-AppxPackage -Package $($a.PackageFullName)"
        Architecture = if ($a.Architecture -eq 9) { "64-bit" } else { "32-bit" }
        WebSite = "https://apps.microsoft.com"
        Comments = "Aplicativo da Microsoft Store / Windows"
        IconBase64 = ""
        PackageFamilyName = [string]$a.PackageFamilyName
        RegistryPath = ""
    }
}

$unique = $appList | Group-Object DisplayName | ForEach-Object { $_.Group[0] } | Sort-Object DisplayName
$unique | ConvertTo-Json -Depth 3 -Compress
