param(
    [Parameter(Mandatory=$true)]
    [string]$DisplayName,

    [Parameter(Mandatory=$false)]
    [string]$Publisher = "",

    [Parameter(Mandatory=$false)]
    [string]$InstallLocation = "",

    [Parameter(Mandatory=$false)]
    [string]$RegistryId = "",

    [Parameter(Mandatory=$false)]
    [string]$ScanLevel = "Moderate" # Safe, Moderate, Deep
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$forbiddenFolders = @(
    "C:\", "C:\Windows", "C:\Windows\System32", "C:\Program Files", "C:\Program Files (x86)",
    "C:\ProgramData", "C:\Users", "$env:USERPROFILE", "$env:APPDATA", "$env:LOCALAPPDATA",
    "$env:TEMP", "C:\Users\Public"
) | ForEach-Object { $_.TrimEnd('\').ToLower() }

$forbiddenKeys = @(
    "HKEY_LOCAL_MACHINE\Software", "HKEY_LOCAL_MACHINE\Software\Microsoft",
    "HKEY_LOCAL_MACHINE\Software\Microsoft\Windows", "HKEY_CURRENT_USER\Software",
    "HKEY_CURRENT_USER\Software\Microsoft", "HKEY_CURRENT_USER\Software\Microsoft\Windows",
    "HKEY_LOCAL_MACHINE\Software\Wow6432Node", "HKEY_LOCAL_MACHINE\Software\Wow6432Node\Microsoft"
) | ForEach-Object { $_.ToLower() }

# Limpeza e extração de termos de busca
$cleanName = ($DisplayName -replace '[^a-zA-Z0-9_\-\s]', '').Trim()
$searchTerms = [System.Collections.Generic.List[string]]::new()

if ($cleanName.Length -ge 3) {
    # remove versões comuns como "6.5.6", "2024", etc.
    $baseName = ($cleanName -replace '\b\d+(\.\d+)*\b', '').Trim()
    if ($baseName.Length -ge 3) { $searchTerms.Add($baseName) }
    $searchTerms.Add($cleanName)
}

if ($RegistryId -and $RegistryId.Trim().Length -ge 4) {
    $searchTerms.Add($RegistryId.Trim())
}

$foundRegistry = [System.Collections.Generic.List[object]]::new()
$foundFileSystem = [System.Collections.Generic.List[object]]::new()

# 1. Checar InstallLocation diretamente
if ($InstallLocation -and (Test-Path $InstallLocation)) {
    $normLoc = $InstallLocation.TrimEnd('\').ToLower()
    if (-not ($forbiddenFolders -contains $normLoc)) {
        try {
            $fCount = (Get-ChildItem -Path $InstallLocation -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
            $fSize = (Get-ChildItem -Path $InstallLocation -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            $foundFileSystem.Add([PSCustomObject]@{
                Type = "Folder"
                Path = $InstallLocation
                Description = "Diretório de Instalação original"
                ItemsCount = $fCount
                SizeBytes = [int64]$fSize
                Selected = $true
            })
        } catch {}
    }
}

# 2. Varrer Pastas Comuns no Disco
$foldersToScan = @(
    "C:\Program Files",
    "C:\Program Files (x86)",
    "C:\ProgramData",
    "$env:APPDATA",
    "$env:LOCALAPPDATA"
)

foreach ($root in $foldersToScan) {
    if (-not (Test-Path $root)) { continue }
    
    foreach ($term in $searchTerms) {
        $candidate = Join-Path $root $term
        if ((Test-Path $candidate) -and (-not ($foundFileSystem.Path -contains $candidate))) {
            $normCand = $candidate.TrimEnd('\').ToLower()
            if (-not ($forbiddenFolders -contains $normCand)) {
                try {
                    $cCount = (Get-ChildItem -Path $candidate -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
                    $cSize = (Get-ChildItem -Path $candidate -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                    $foundFileSystem.Add([PSCustomObject]@{
                        Type = "Folder"
                        Path = $candidate
                        Description = "Pasta residual em $root"
                        ItemsCount = $cCount
                        SizeBytes = [int64]$cSize
                        Selected = $true
                    })
                } catch {}
            }
        }
    }
}

# 3. Varrer atalhos no Desktop e Menu Iniciar
$shortcutDirs = @(
    "$env:USERPROFILE\Desktop",
    "C:\Users\Public\Desktop",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "C:\ProgramData\Microsoft\Windows\Start Menu\Programs"
)

foreach ($dir in $shortcutDirs) {
    if (-not (Test-Path $dir)) { continue }
    foreach ($term in $searchTerms) {
        $filter = "*$term*.lnk"
        $shortcuts = Get-ChildItem -Path $dir -Filter $filter -Recurse -File -ErrorAction SilentlyContinue
        foreach ($s in $shortcuts) {
            if (-not ($foundFileSystem.Path -contains $s.FullName)) {
                $foundFileSystem.Add([PSCustomObject]@{
                    Type = "Shortcut"
                    Path = $s.FullName
                    Description = "Atalho residual ($($s.Name))"
                    ItemsCount = 1
                    SizeBytes = $s.Length
                    Selected = $true
                })
            }
        }
    }
}

# 4. Varrer Registro do Windows
$regHives = @(
    "HKCU:\Software",
    "HKLM:\Software",
    "HKLM:\Software\Wow6432Node"
)

foreach ($hive in $regHives) {
    if (-not (Test-Path $hive)) { continue }
    
    foreach ($term in $searchTerms) {
        $candidateKey = Join-Path $hive $term
        if (Test-Path $candidateKey) {
            $keyObj = Get-Item -Path $candidateKey -ErrorAction SilentlyContinue
            if ($keyObj) {
                $fullReg = $keyObj.Name
                $normReg = $fullReg.ToLower()
                if (-not ($forbiddenKeys -contains $normReg)) {
                    $foundRegistry.Add([PSCustomObject]@{
                        Hive = $hive
                        KeyPath = $fullReg
                        PSPath = $candidateKey
                        SubKeyCount = $keyObj.SubKeyCount
                        ValueCount = $keyObj.ValueCount
                        Description = "Chave de software em $hive"
                        Selected = $true
                    })
                }
            }
        }
    }
}

# 5. Checar se a chave do Uninstall ainda existe
$uninstallHives = @(
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
)
if ($RegistryId) {
    foreach ($uHive in $uninstallHives) {
        $uPath = Join-Path $uHive $RegistryId
        if (Test-Path $uPath) {
            $uObj = Get-Item -Path $uPath -ErrorAction SilentlyContinue
            if ($uObj) {
                $foundRegistry.Add([PSCustomObject]@{
                    Hive = $uHive
                    KeyPath = $uObj.Name
                    PSPath = $uPath
                    SubKeyCount = $uObj.SubKeyCount
                    ValueCount = $uObj.ValueCount
                    Description = "Entrada residual no Painel de Controle / Desinstalação"
                    Selected = $true
                })
            }
        }
    }
}

$result = [PSCustomObject]@{
    DisplayName = $DisplayName
    RegistryLeftovers = $foundRegistry
    FileSystemLeftovers = $foundFileSystem
    TotalRegistryCount = $foundRegistry.Count
    TotalFileSystemCount = $foundFileSystem.Count
    TotalSizeBytes = ($foundFileSystem | Measure-Object -Property SizeBytes -Sum).Sum
}

$result | ConvertTo-Json -Depth 4 -Compress
