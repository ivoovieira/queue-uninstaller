[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$forbiddenFolders = @(
    "C:\", "C:\Windows", "C:\Windows\System32", "C:\Program Files", "C:\Program Files (x86)",
    "C:\ProgramData", "C:\Users", "$env:USERPROFILE", "$env:APPDATA", "$env:LOCALAPPDATA",
    "$env:LOCALAPPDATA\Programs", "$env:TEMP", "C:\Users\Public", "C:\Users\Default"
) | ForEach-Object { $_.TrimEnd('\').ToLower() }

$systemWhitelist = @(
    "microsoft", "windows", "windows defender", "windows nt", "windows mail",
    "internet explorer", "edge", "google", "mozilla", "chrome", "firefox",
    "intel", "amd", "nvidia", "realtek", "synaptics", "dell", "hp", "lenovo",
    "asus", "acer", "apple", "oracle", "java", "python", "powershell",
    "windowspowershell", "git", "github", "nodejs", "npm", "yarn", "docker",
    "wsl", "system volume information", "`$recycle.bin", "common files",
    "packages", "temp", "all users", "classes", "policies", "clients",
    "registeredapplications", "services", "system", "security", "sam",
    "hardwareresources", "directx", "cryptography", "dotnet", "antigravity", "queu",
    "package cache", "softwaredistribution", "usoprivate", "usoshared", "ssh",
    "windowsholographicdevices", "whesvc", "regid"
)

# 1. Coletar inventário de softwares instalados para referência cruzada
$uninstallKeys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

$installedTokens = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$installedPaths = [System.Collections.Generic.List[string]]::new()
$runningProcesses = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.ProcessName) { [void]$runningProcesses.Add($_.ProcessName) }
}

$rawApps = Get-ItemProperty -Path $uninstallKeys -ErrorAction SilentlyContinue
foreach ($app in $rawApps) {
    if ($app.DisplayName) {
        $clean = ($app.DisplayName -replace '[^a-zA-Z0-9]', ' ').Trim()
        foreach ($word in $clean.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)) {
            if ($word.Length -ge 3) { [void]$installedTokens.Add($word) }
        }
        [void]$installedTokens.Add($clean)
    }
    if ($app.Publisher) {
        $cleanPub = ($app.Publisher -replace '[^a-zA-Z0-9]', ' ').Trim()
        foreach ($word in $cleanPub.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)) {
            if ($word.Length -ge 3) { [void]$installedTokens.Add($word) }
        }
    }
    if ($app.InstallLocation) {
        $loc = $app.InstallLocation.Trim('"').Trim().TrimEnd('\').ToLower()
        if ($loc -and -not ($forbiddenFolders -contains $loc)) {
            $installedPaths.Add($loc)
        }
    }
    if ($app.PSChildName) {
        [void]$installedTokens.Add($app.PSChildName)
    }
}

$foundItems = [System.Collections.Generic.List[object]]::new()
$itemIdCounter = 1

function Is-SystemWhitelisted($name) {
    if (-not $name) { return $true }
    $n = $name.ToLower()
    foreach ($sw in $systemWhitelist) {
        if ($n -eq $sw -or $n.StartsWith("$sw ") -or $n.StartsWith("$sw-") -or $n.StartsWith("$sw.") -or $n.Contains($sw)) {
            return $true
        }
    }
    return $false
}

# ==============================================================================
# 2. Varrer App Paths (HKLM e HKCU) buscando ponteiros mortos (🟢 Seguro)
# ==============================================================================
$appPathsHives = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths",
    "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\App Paths"
)

foreach ($apHive in $appPathsHives) {
    if (-not (Test-Path $apHive)) { continue }
    $subKeys = Get-ChildItem -Path $apHive -ErrorAction SilentlyContinue
    foreach ($sk in $subKeys) {
        $props = Get-ItemProperty -Path $sk.PSPath -ErrorAction SilentlyContinue
        $targetExe = ""
        if ($props.'(default)') {
            $targetExe = $props.'(default)'.Trim('"').Trim()
        } elseif ($props.Path) {
            $targetExe = Join-Path $props.Path.Trim('"').Trim() $sk.PSChildName
        }

        if ($targetExe) {
            $exeExists = $false
            try {
                if (Test-Path -Path $targetExe -PathType Leaf) { $exeExists = $true }
            } catch {}

            if (-not $exeExists) {
                # Ponteiro quebrado / executável deletado
                $foundItems.Add([PSCustomObject]@{
                    Id = "orphan_$itemIdCounter"
                    Name = $sk.PSChildName
                    Path = $sk.PSPath
                    RegistryKey = $sk.Name
                    Type = "RegistryAppPath"
                    Risk = "Safe"
                    Reason = "Entrada em App Paths aponta para executável inexistente ($targetExe)"
                    SizeBytes = [int64]0
                    Selected = $true
                })
                $itemIdCounter++
            }
        }
    }
}

# ==============================================================================
# 3. Varrer Pastas Vazias Abandonadas em Program Files (🟢 Seguro)
# ==============================================================================
$progRoots = @("C:\Program Files", "C:\Program Files (x86)")
foreach ($pr in $progRoots) {
    if (-not (Test-Path $pr)) { continue }
    $dirs = Get-ChildItem -Path $pr -Directory -ErrorAction SilentlyContinue
    foreach ($d in $dirs) {
        $dLower = $d.Name.ToLower()
        if (Is-SystemWhitelisted $d.Name) { continue }
        if ($forbiddenFolders -contains $d.FullName.ToLower()) { continue }

        # Verificar se está na lista de instalados
        $isInstalled = $false
        foreach ($tok in $installedTokens) {
            if ($tok -and ($dLower -eq $tok.ToLower() -or $dLower.Contains($tok.ToLower()))) {
                $isInstalled = $true
                break
            }
        }
        if ($isInstalled) { continue }

        # Checar se a pasta está vazia de arquivos reais
        $files = Get-ChildItem -Path $d.FullName -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $files) {
            $foundItems.Add([PSCustomObject]@{
                Id = "orphan_$itemIdCounter"
                Name = $d.Name
                Path = $d.FullName
                Type = "EmptyFolder"
                Risk = "Safe"
                Reason = "Pasta vazia abandonada em $($d.Parent.Name)"
                SizeBytes = [int64]0
                Selected = $true
            })
            $itemIdCounter++
        }
    }
}

# ==============================================================================
# 4. Varrer Caches de Instaladores Antigos (🟢 Seguro)
# ==============================================================================
$squirrelTemp = "$env:LOCALAPPDATA\SquirrelTemp"
if (Test-Path $squirrelTemp) {
    $sqItems = Get-ChildItem -Path $squirrelTemp -ErrorAction SilentlyContinue
    foreach ($sq in $sqItems) {
        $sqSize = if ($sq.PSIsContainer) {
            (Get-ChildItem -Path $sq.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        } else { $sq.Length }

        $foundItems.Add([PSCustomObject]@{
            Id = "orphan_$itemIdCounter"
            Name = $sq.Name
            Path = $sq.FullName
            Type = "ResidualCache"
            Risk = "Safe"
            Reason = "Arquivo temporário residual de instalador Squirrel abandonado"
            SizeBytes = [int64]$sqSize
            Selected = $true
        })
        $itemIdCounter++
    }
}

# ==============================================================================
# 5. Varrer Chaves Órfãs no Registro (🟡 Atenção - Requer Revisão)
# ==============================================================================
$regScanHives = @("HKCU:\Software", "HKLM:\Software")
foreach ($rHive in $regScanHives) {
    if (-not (Test-Path $rHive)) { continue }
    $vendorKeys = Get-ChildItem -Path $rHive -ErrorAction SilentlyContinue
    foreach ($vk in $vendorKeys) {
        if (Is-SystemWhitelisted $vk.PSChildName) { continue }
        if ($installedTokens.Contains($vk.PSChildName)) { continue }

        # Checar se tem subchaves
        $subDirs = Get-ChildItem -Path $vk.PSPath -ErrorAction SilentlyContinue
        if ($subDirs) {
            foreach ($sub in $subDirs) {
                $subName = $sub.PSChildName.ToLower()
                if ($installedTokens.Contains($sub.PSChildName)) { continue }

                # Verificar se algum valor dentro aponta para pasta existente
                $hasValidPath = $false
                $vals = Get-ItemProperty -Path $sub.PSPath -ErrorAction SilentlyContinue
                if ($vals) {
                    foreach ($p in $vals.PSObject.Properties) {
                        $v = [string]$p.Value
                        if ($v -and ($v -match '^[a-zA-Z]:\\') -and (Test-Path $v)) {
                            $hasValidPath = $true
                            break
                        }
                    }
                }

                if (-not $hasValidPath) {
                    $foundItems.Add([PSCustomObject]@{
                        Id = "orphan_$itemIdCounter"
                        Name = "$($vk.PSChildName)\$($sub.PSChildName)"
                        Path = $sub.PSPath
                        RegistryKey = $sub.Name
                        Type = "RegistryKey"
                        Risk = "Review"
                        Reason = "Chave de software em $rHive sem aplicativo correspondente ativo"
                        SizeBytes = [int64]0
                        Selected = $false
                    })
                    $itemIdCounter++
                }
            }
        }
    }
}

# ==============================================================================
# 6. Varrer Pastas em AppData / ProgramData Abandonadas (🟡 Atenção - Requer Revisão)
# ==============================================================================
$appDataRoots = @("$env:APPDATA", "$env:LOCALAPPDATA", "C:\ProgramData")
foreach ($adRoot in $appDataRoots) {
    if (-not (Test-Path $adRoot)) { continue }
    $dirs = Get-ChildItem -Path $adRoot -Directory -ErrorAction SilentlyContinue
    foreach ($d in $dirs) {
        $dLower = $d.Name.ToLower()
        if (Is-SystemWhitelisted $d.Name) { continue }
        if ($forbiddenFolders -contains $d.FullName.ToLower()) { continue }

        # Verificar se está associado a programa instalado
        $isInstalled = $false
        foreach ($tok in $installedTokens) {
            if ($tok -and ($dLower -eq $tok.ToLower() -or $dLower.Contains($tok.ToLower()))) {
                $isInstalled = $true
                break
            }
        }
        if ($isInstalled) { continue }

        # Verificar se há processos rodando vinculados
        if ($runningProcesses.Contains($d.Name)) { continue }

        # Calcular tamanho
        try {
            $fCount = (Get-ChildItem -Path $d.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
            $fSize = (Get-ChildItem -Path $d.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            
            # Se a pasta não possui processos ativos e não é do sistema
            $foundItems.Add([PSCustomObject]@{
                Id = "orphan_$itemIdCounter"
                Name = $d.Name
                Path = $d.FullName
                Type = "ResidualFolder"
                Risk = "Review"
                Reason = "Pasta em $($d.Parent.Name) de programa que não consta na lista de instalados"
                SizeBytes = [int64]$fSize
                Selected = $false
            })
            $itemIdCounter++
        } catch {}
    }
}

$safeItems = $foundItems | Where-Object { $_.Risk -eq "Safe" }
$reviewItems = $foundItems | Where-Object { $_.Risk -eq "Review" }
$totalBytes = ($foundItems | Measure-Object -Property SizeBytes -Sum).Sum

$result = [PSCustomObject]@{
    Success = $true
    Items = $foundItems
    TotalCount = $foundItems.Count
    TotalSizeBytes = [int64]$totalBytes
    SafeCount = ($safeItems | Measure-Object).Count
    ReviewCount = ($reviewItems | Measure-Object).Count
}

$result | ConvertTo-Json -Depth 4 -Compress
