[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 5; step = "Consultando catálogo Appx/MSIX no Windows..." } | ConvertTo-Json -Compress))

$rawApps = @(try {
    Get-AppxPackage -AllUsers -ErrorAction Stop | Where-Object { (-not $_.IsFramework) -and (-not $_.NonRemovable) }
} catch {
    Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { (-not $_.IsFramework) -and (-not $_.NonRemovable) }
})

$totalApps = $rawApps.Count
[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 15; step = "Lendo pacotes AppX: $totalApps encontrados..." } | ConvertTo-Json -Compress))

$current = 0
$appList = foreach ($a in $rawApps) {
    $current++
    $pct = [math]::Round(15 + (($current / [math]::Max($totalApps, 1)) * 75))
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

    # Tenta extrair o DisplayName e PublisherDisplayName reais do AppxManifest.xml
    $manifestDisplayName = ""
    $manifestPublisher = ""
    if ($a.InstallLocation) {
        $mPath = Join-Path $a.InstallLocation "AppxManifest.xml"
        if (Test-Path -LiteralPath $mPath) {
            try {
                [xml]$mXml = Get-Content -LiteralPath $mPath -Raw -ErrorAction SilentlyContinue
                $mDisp = $mXml.Package.Properties.DisplayName
                if (-not $mDisp -or ($mDisp -like "ms-resource:*")) {
                    $mDisp = $mXml.Package.Applications.Application[0].VisualElements.DisplayName
                }
                if ($mDisp -and -not ($mDisp -like "ms-resource:*")) {
                    $manifestDisplayName = [string]$mDisp
                }
                $mPub = $mXml.Package.Properties.PublisherDisplayName
                if ($mPub) {
                    $manifestPublisher = [string]$mPub
                }
            } catch {}
        }
    }

    if ($manifestDisplayName) {
        $friendlyName = $manifestDisplayName
    }

    [Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = $pct; step = "Examinando $friendlyName ($current de $totalApps)..." } | ConvertTo-Json -Compress))

    # Tamanho da pasta
    $sizeKb = 0
    if ($a.InstallLocation -and (Test-Path $a.InstallLocation)) {
        try {
            $fSize = (Get-ChildItem -Path $a.InstallLocation -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            if ($fSize) { $sizeKb = [int64]($fSize / 1024) }
        } catch {}
    }

    $pub = if ($manifestPublisher) { $manifestPublisher } else { [string]($a.Publisher -replace 'CN=|,.*', '') }
    if (-not $pub) { $pub = "Microsoft Corporation" }

    $comments = if ($rawName -and $rawName -ne $friendlyName) {
        "Aplicativo da Microsoft Store / Windows ($rawName)"
    } else {
        "Aplicativo da Microsoft Store / Windows"
    }

    if ($friendlyName -match '(?i)Windows Subsystem for Linux|WSL') {
        $friendlyName = 'Windows Subsystem for Linux (WSL / WSL Settings)'
        $comments = "WSL, WSL Settings, Linux, Configurações do WSL $comments"
    }

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
        Comments = $comments
        IconBase64 = ""
        PackageFamilyName = [string]$a.PackageFamilyName
        RegistryPath = ""
    }
}

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 95; step = "Finalizando lista de apps..." } | ConvertTo-Json -Compress))
$unique = $appList | Group-Object DisplayName | ForEach-Object { $_.Group[0] } | Sort-Object DisplayName
[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 100; step = "Concluído!" } | ConvertTo-Json -Compress))
$unique | ConvertTo-Json -Depth 3 -Compress
