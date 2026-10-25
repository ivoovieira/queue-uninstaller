[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Notifica início da varredura
[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 5; step = "Inicializando varredura de resíduos órfãos..." } | ConvertTo-Json -Compress))

$forbiddenFolders = @(
    "C:\", "C:\Windows", "C:\Windows\System32", "C:\Program Files", "C:\Program Files (x86)",
    "C:\ProgramData", "C:\Users", "$env:USERPROFILE", "$env:APPDATA", "$env:LOCALAPPDATA",
    "$env:LOCALAPPDATA\Programs", "$env:TEMP", "C:\Users\Public", "C:\Users\Default"
) | ForEach-Object { $_.TrimEnd('\').ToLower() }

$systemWhitelist = @(
    # Sistema operacional, navegadores e utilitários base
    "microsoft", "windows", "windows defender", "windows nt", "windows mail",
    "internet explorer", "edge", "google", "mozilla", "chrome", "firefox", "brave", "opera",
    "git", "github", "nodejs", "npm", "yarn", "docker", "wsl", "system volume information",
    "`$recycle.bin", "common files", "packages", "temp", "all users", "classes", "policies",
    "clients", "registeredapplications", "services", "system", "security", "sam",
    "hardwareresources", "cryptography", "dotnet", "antigravity", "queu", "wow6432node",
    "package cache", "softwaredistribution", "usoprivate", "usoshared", "ssh",
    "windowsholographicdevices", "whesvc", "regid",

    # Drivers, hardware, áudio e periféricos vitais
    "intel", "amd", "ati", "radeon", "catalyst", "adrenalin", "ace", "nvidia", "geforce",
    "realtek", "synaptics", "dell", "hp", "lenovo", "asus", "acer", "apple", "oracle", "java",
    "python", "powershell", "windowspowershell", "corsair", "logitech", "razer", "steelseries",
    "roccat", "hyperx", "gigabyte", "msi", "asrock", "evga", "nzxt", "creative",
    "creativetechnology", "soundblaster", "dolby", "nahimic", "qualcomm", "broadcom",

    # Gráficos, 3D, SDKs e Gaming Runtimes
    "directx", "vulkan", "khronos", "opengl", "opencl", "physx", "cuda",
    "epic games", "epicgameslauncher", "epicgames", "unreal", "unrealengine",
    "ea", "electronic arts", "origin", "steam", "valvesoftware", "valve",
    "ubisoft", "uplay", "gog.com", "gog galaxy", "blizzard", "battlenet", "battle.net",
    "riot games", "rockstar games", "wargaming", "unity",

    # Anti-cheats e proteções DRM de jogos
    "denuvo", "anticheat", "easyanticheat", "battleye", "vanguard", "faceit", "punkbuster", "eac"
)

function Is-SystemWhitelisted($name) {
    if (-not $name) { return $true }
    $n = $name.ToLower().Trim()

    foreach ($sw in $systemWhitelist) {
        $swLower = $sw.ToLower()
        if ($n -eq $swLower) { return $true }

        # Termos curtos (<= 3 letras): evitar falso positivo em palavras maiores (ex: 'ea' em 'steam')
        if ($swLower.Length -le 3) {
            if ($n.StartsWith("$swLower ") -or $n.StartsWith("$swLower\") -or $n.StartsWith("$swLower-") -or $n.StartsWith("$swLower.") -or $n.EndsWith("\$swLower")) {
                return $true
            }
            $tokens = $n -split '[\s\-_\\/.]+'
            if ($tokens -contains $swLower) {
                return $true
            }
        } else {
            # Termos com mais de 3 letras: prefixo, contenção segura ou versão normalizada sem espaços
            if ($n.StartsWith("$swLower ") -or $n.StartsWith("$swLower\") -or $n.StartsWith("$swLower-") -or $n.StartsWith("$swLower.") -or $n.Contains($swLower)) {
                return $true
            }
            $cleanN = ($n -replace '[^a-z0-9]', '')
            $cleanSW = ($swLower -replace '[^a-z0-9]', '')
            if ($cleanSW.Length -ge 5 -and $cleanN.Contains($cleanSW)) {
                return $true
            }
        }
    }
    return $false
}

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 15; step = "Mapeando inventário de softwares instalados..." } | ConvertTo-Json -Compress))

# 1. Coletar inventário de softwares instalados para referência cruzada
$uninstallKeys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

$installedTokens = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$installedPaths = [System.Collections.Generic.List[string]]::new()
$installedNormalized = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$runningProcesses = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.ProcessName) { [void]$runningProcesses.Add($_.ProcessName) }
}

$companySuffixes = @('gmbh', 'llc', 'inc', 'corp', 'corporation', 'ltd', 'limited', 'co', 'technologies', 'software', 'systems', 'sarl', 'bv', 'sa')

$rawApps = Get-ItemProperty -Path $uninstallKeys -ErrorAction SilentlyContinue
foreach ($app in $rawApps) {
    if ($app.DisplayName) {
        $dn = $app.DisplayName.Trim()
        [void]$installedTokens.Add($dn)

        $clean = ($dn -replace '[^a-zA-Z0-9]', ' ').Trim()
        foreach ($word in $clean.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)) {
            if ($word.Length -ge 3) { [void]$installedTokens.Add($word) }
        }
        [void]$installedTokens.Add($clean)

        $noSpaces = ($clean -replace '\s+', '')
        if ($noSpaces.Length -ge 3) {
            [void]$installedTokens.Add($noSpaces)
            [void]$installedNormalized.Add($noSpaces.ToLower())
        }
    }

    if ($app.Publisher) {
        $pub = $app.Publisher.Trim()
        [void]$installedTokens.Add($pub)

        $cleanPub = ($pub -replace '[^a-zA-Z0-9]', ' ').Trim()
        foreach ($word in $cleanPub.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)) {
            if ($word.Length -ge 3) { [void]$installedTokens.Add($word) }
        }
        [void]$installedTokens.Add($cleanPub)

        # Remove sufixos empresariais comuns (ex: "JAM Software GmbH" -> "JAM Software")
        $pubWords = $cleanPub.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
        $strippedWords = $pubWords | Where-Object { $companySuffixes -notcontains $_.ToLower() }
        if ($strippedWords) {
            $strippedPub = ($strippedWords -join ' ').Trim()
            if ($strippedPub.Length -ge 3) {
                [void]$installedTokens.Add($strippedPub)
                $strippedNoSpaces = ($strippedPub -replace '\s+', '')
                [void]$installedTokens.Add($strippedNoSpaces)
                [void]$installedNormalized.Add($strippedNoSpaces.ToLower())
            }
        }

        if ($app.DisplayName) {
            [void]$installedTokens.Add("$pub $($app.DisplayName)")
            if ($strippedWords) {
                [void]$installedTokens.Add("$strippedPub $($app.DisplayName)")
                $comboNoSpaces = ("$strippedPub$($app.DisplayName)" -replace '[^a-zA-Z0-9]', '')
                [void]$installedTokens.Add($comboNoSpaces)
                [void]$installedNormalized.Add($comboNoSpaces.ToLower())
            }
        }
    }

    # Extrai pastas de InstallLocation, UninstallString e DisplayIcon
    $candidateDirs = @()
    if ($app.InstallLocation) {
        $loc = $app.InstallLocation.Trim('"').Trim().TrimEnd('\')
        if ($loc) { $candidateDirs += $loc }
    }

    if ($app.UninstallString) {
        $uStr = $app.UninstallString.Trim()
        $uExe = ''
        if ($uStr -match '^\s*"([^"]+?\.exe)"') { $uExe = $Matches[1] }
        elseif ($uStr -match '^\s*([^\s"]+?\.exe)') { $uExe = $Matches[1] }
        if ($uExe -and ($uExe -notmatch '(?i)msiexec\.exe')) {
            $candidateDirs += (Split-Path -Path $uExe -Parent)
        }
    }

    if ($app.DisplayIcon) {
        $cleanIcon = ($app.DisplayIcon -split ',')[0].Trim('"').Trim()
        if ($cleanIcon -and ($cleanIcon -notmatch '(?i)msiexec\.exe') -and ($cleanIcon -match '\.exe$|\.ico$')) {
            $candidateDirs += (Split-Path -Path $cleanIcon -Parent)
        }
    }

    foreach ($cd in $candidateDirs) {
        if (-not $cd) { continue }
        $normCd = [Environment]::ExpandEnvironmentVariables($cd).TrimEnd('\')
        if ($normCd -and -not ($forbiddenFolders -contains $normCd.ToLower())) {
            $installedPaths.Add($normCd.ToLower())

            try {
                $leafName = Split-Path -Path $normCd -Leaf
                if ($leafName -and $leafName.Length -ge 3) {
                    [void]$installedTokens.Add($leafName)
                    $leafNoSpaces = ($leafName -replace '[^a-zA-Z0-9]', '')
                    [void]$installedTokens.Add($leafNoSpaces)
                    [void]$installedNormalized.Add($leafNoSpaces.ToLower())
                }
                $parentDir = Split-Path -Path $normCd -Parent
                if ($parentDir) {
                    $grandName = Split-Path -Path $parentDir -Leaf
                    if ($grandName -and $grandName.Length -ge 3 -and -not ($grandName -match '(?i)program files|appdata|local|roaming|programs')) {
                        [void]$installedTokens.Add($grandName)
                        $grandNoSpaces = ($grandName -replace '[^a-zA-Z0-9]', '')
                        [void]$installedTokens.Add($grandNoSpaces)
                        [void]$installedNormalized.Add($grandNoSpaces.ToLower())
                    }
                }
            } catch {}
        }
    }

    if ($app.PSChildName) {
        [void]$installedTokens.Add($app.PSChildName)
    }
}

# Coleta diretórios de bibliotecas de jogos em todos os discos rígidos e SSDs do sistema (D:\, E:\, etc.)
$gameRoots = [System.Collections.Generic.List[string]]::new()
$fixedDrives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Free -gt 0 }
foreach ($drv in $fixedDrives) {
    $driveLetter = "$($drv.Name):\"
    $commonGameDirs = @(
        "$($drv.Name):\Games",
        "$($drv.Name):\Jogos",
        "$($drv.Name):\SteamLibrary",
        "$($drv.Name):\SteamLibrary\steamapps\common",
        "$($drv.Name):\Epic Games",
        "$($drv.Name):\GOG Games",
        "$($drv.Name):\GOG Galaxy\Games",
        "$($drv.Name):\EA Games",
        "$($drv.Name):\Ubisoft Game Launcher\games",
        "$($drv.Name):\Riot Games",
        "$($drv.Name):\XboxGames"
    )
    foreach ($cgd in $commonGameDirs) {
        if (Test-Path $cgd) {
            $gameRoots.Add($cgd.ToLower())
        }
    }
}

function Test-AppOrGameExistsOnDisk($vendorName, $appName) {
    if (-not $appName) { return $false }
    $cleanApp = $appName.Trim()
    $cleanVendor = if ($vendorName) { $vendorName.Trim() } else { '' }

    $searchBases = @(
        "C:\Program Files",
        "C:\Program Files (x86)",
        "C:\ProgramData",
        "$env:LOCALAPPDATA\Programs",
        "$env:APPDATA",
        "$env:LOCALAPPDATA"
    )
    foreach ($gr in $gameRoots) {
        $searchBases += $gr
    }

    $noSpacesApp = ($cleanApp -replace '[^a-zA-Z0-9]', '')

    foreach ($base in $searchBases) {
        if (-not (Test-Path $base)) { continue }

        # 1. Base\Vendor\App
        if ($cleanVendor) {
            $p1 = Join-Path (Join-Path $base $cleanVendor) $cleanApp
            if (Test-Path $p1) { return $true }
            if ($noSpacesApp) {
                $p1b = Join-Path (Join-Path $base $cleanVendor) $noSpacesApp
                if (Test-Path $p1b) { return $true }
            }
        }

        # 2. Base\App
        $p2 = Join-Path $base $cleanApp
        if (Test-Path $p2) { return $true }

        # 3. Base\App (sem espaços)
        if ($noSpacesApp) {
            $p3 = Join-Path $base $noSpacesApp
            if (Test-Path $p3) { return $true }
        }
    }

    # Checa também nas raízes de discos secundários (D:\Nome, E:\Nome, etc.)
    foreach ($drv in $fixedDrives) {
        $rootApp = "$($drv.Name):\$cleanApp"
        if (Test-Path $rootApp) { return $true }
        if ($noSpacesApp) {
            $rootAppNoSp = "$($drv.Name):\$noSpacesApp"
            if (Test-Path $rootAppNoSp) { return $true }
        }
    }

    return $false
}

$foundItems = [System.Collections.Generic.List[object]]::new()
$itemIdCounter = 1

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 35; step = "Varrendo App Paths no Registro (ponteiros mortos)..." } | ConvertTo-Json -Compress))

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

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 50; step = "Varrendo pastas vazias em Program Files..." } | ConvertTo-Json -Compress))

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

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 65; step = "Varrendo caches de instaladores temporários..." } | ConvertTo-Json -Compress))

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

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 75; step = "Varrendo chaves órfãs no Registro (HKCU / HKLM)..." } | ConvertTo-Json -Compress))

# ==============================================================================
# 5. Varrer Chaves Órfãs no Registro (🟡 Atenção - Requer Revisão)
# ==============================================================================
$regScanHives = @("HKCU:\Software", "HKLM:\Software")
foreach ($rHive in $regScanHives) {
    if (-not (Test-Path $rHive)) { continue }
    $vendorKeys = Get-ChildItem -Path $rHive -ErrorAction SilentlyContinue
    foreach ($vk in $vendorKeys) {
        $vkName = $vk.PSChildName
        if ($vkName -eq 'WOW6432Node' -or (Is-SystemWhitelisted $vkName)) { continue }
        if ($installedTokens.Contains($vkName)) { continue }

        $vkNorm = ($vkName -replace '[^a-zA-Z0-9]', '').ToLower()
        if ($vkNorm -and $installedNormalized.Contains($vkNorm)) { continue }

        # Checar se tem subchaves
        $subDirs = Get-ChildItem -Path $vk.PSPath -ErrorAction SilentlyContinue
        if ($subDirs) {
            foreach ($sub in $subDirs) {
                $subName = $sub.PSChildName
                if (Is-SystemWhitelisted $subName) { continue }
                if ($installedTokens.Contains($subName)) { continue }

                $subNorm = ($subName -replace '[^a-zA-Z0-9]', '').ToLower()
                if ($subNorm -and $installedNormalized.Contains($subNorm)) { continue }

                # Verificar se o executável ou pasta existe fisicamente em algum disco do sistema
                if (Test-AppOrGameExistsOnDisk -vendorName $vkName -appName $subName) {
                    continue
                }

                # Verificar se algum valor dentro da chave aponta para arquivo ou pasta existente no disco
                $hasValidPath = $false
                $vals = Get-ItemProperty -Path $sub.PSPath -ErrorAction SilentlyContinue
                if ($vals) {
                    foreach ($p in $vals.PSObject.Properties) {
                        $v = [string]$p.Value
                        if (-not $v) { continue }

                        $candPath = ''
                        if ($v -match '^[a-zA-Z]:\\([^\r\n"<>|]+)') {
                            $candPath = $Matches[0]
                        } elseif ($v -match '"([a-zA-Z]:\\[^"]+)"') {
                            $candPath = $Matches[1]
                        }

                        if ($candPath) {
                            if ($candPath -match '^(.*?\.exe)(?:\s.*)?$') {
                                $candPath = $Matches[1]
                            }
                            try {
                                if (Test-Path $candPath) {
                                    $hasValidPath = $true
                                    break
                                }
                            } catch {}
                        }
                    }
                }

                if (-not $hasValidPath) {
                    $foundItems.Add([PSCustomObject]@{
                        Id = "orphan_$itemIdCounter"
                        Name = "$vkName\$subName"
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

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 90; step = "Varrendo diretórios abandonados em AppData e ProgramData..." } | ConvertTo-Json -Compress))

# ==============================================================================
# 6. Varrer Pastas em AppData / ProgramData Abandonadas (🟡 Atenção - Requer Revisão)
# ==============================================================================
$appDataRoots = @("$env:APPDATA", "$env:LOCALAPPDATA", "C:\ProgramData")
foreach ($adRoot in $appDataRoots) {
    if (-not (Test-Path $adRoot)) { continue }
    $dirs = Get-ChildItem -Path $adRoot -Directory -ErrorAction SilentlyContinue
    foreach ($d in $dirs) {
        $dName = $d.Name
        if (Is-SystemWhitelisted $dName) { continue }
        if ($forbiddenFolders -contains $d.FullName.ToLower()) { continue }

        if ($installedTokens.Contains($dName)) { continue }

        $dNorm = ($dName -replace '[^a-zA-Z0-9]', '').ToLower()
        if ($dNorm -and $installedNormalized.Contains($dNorm)) { continue }

        # Se existe aplicativo ou jogo correspondente em algum disco
        if (Test-AppOrGameExistsOnDisk -vendorName '' -appName $dName) {
            continue
        }

        # Verificar se há processos rodando vinculados
        if ($runningProcesses.Contains($dName)) { continue }

        # Calcular tamanho
        try {
            $fCount = (Get-ChildItem -Path $d.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
            $fSize = (Get-ChildItem -Path $d.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum

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

[Console]::Error.WriteLine('[PROGRESS]' + (@{ pct = 100; step = "Varredura de resíduos concluída!" } | ConvertTo-Json -Compress))

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
