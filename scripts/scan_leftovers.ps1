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
    "$env:LOCALAPPDATA\Programs", "$env:TEMP", "C:\Users\Public"
) | ForEach-Object { $_.TrimEnd('\').ToLower() }

$forbiddenKeys = @(
    "HKEY_LOCAL_MACHINE\Software", "HKEY_LOCAL_MACHINE\Software\Microsoft",
    "HKEY_LOCAL_MACHINE\Software\Microsoft\Windows", "HKEY_CURRENT_USER\Software",
    "HKEY_CURRENT_USER\Software\Microsoft", "HKEY_CURRENT_USER\Software\Microsoft\Windows",
    "HKEY_LOCAL_MACHINE\Software\Wow6432Node", "HKEY_LOCAL_MACHINE\Software\Wow6432Node\Microsoft",
    "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services",
    "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum",
    "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control",
    "HKEY_CURRENT_USER\Software\Classes",
    "HKEY_LOCAL_MACHINE\Software\Classes"
) | ForEach-Object { $_.ToLower() }

$genericPublishers = @(
    "microsoft", "google", "apple", "adobe", "oracle", "intel", "amd", "nvidia",
    "microsoft corporation", "google llc", "corporation", "ltd", "inc"
)

# Termos de Busca
$cleanName = ($DisplayName -replace '[^a-zA-Z0-9_\-\s]', '').Trim()
$searchTerms = [System.Collections.Generic.List[string]]::new()
$publisherTerms = [System.Collections.Generic.List[string]]::new()

if ($cleanName.Length -ge 2) {
    $baseName = ($cleanName -replace '\b\d+(\.\d+)*\b', '').Trim()
    if ($baseName.Length -ge 2 -and -not ($searchTerms -contains $baseName)) { $searchTerms.Add($baseName) }
    if (-not ($searchTerms -contains $cleanName)) { $searchTerms.Add($cleanName) }
    
    $compressedName = ($cleanName -replace '\s+', '').Trim()
    if ($compressedName.Length -ge 3 -and -not ($searchTerms -contains $compressedName)) {
        $searchTerms.Add($compressedName)
    }
}

if ($RegistryId -and $RegistryId.Trim().Length -ge 3) {
    $cleanRegId = $RegistryId.Trim()
    if (-not ($searchTerms -contains $cleanRegId)) {
        $searchTerms.Add($cleanRegId)
    }
}

# Tratamento do Fabricante (Publisher) para busca cruzada (ex: famatech para Advanced IP Scanner)
if ($Publisher) {
    $pubTerm = ($Publisher -replace '[^a-zA-Z0-9_\-\s]', '').Trim()
    if ($pubTerm.Length -ge 3 -and -not ($genericPublishers -contains $pubTerm.ToLower())) {
        if (-not $publisherTerms.Contains($pubTerm)) {
            $publisherTerms.Add($pubTerm)
        }
        $pubFirst = ($pubTerm.Split(' ')[0]).Trim()
        if ($pubFirst.Length -ge 3 -and -not ($genericPublishers -contains $pubFirst.ToLower()) -and -not $publisherTerms.Contains($pubFirst)) {
            $publisherTerms.Add($pubFirst)
        }
    }
}

$foundRegistry = [System.Collections.Generic.List[object]]::new()
$foundFileSystem = [System.Collections.Generic.List[object]]::new()
$foundFirewall = [System.Collections.Generic.List[object]]::new()

# 1. Checar InstallLocation diretamente
$normInstallLoc = ""
if ($InstallLocation) {
    $normLocation = $InstallLocation.Trim('"').Trim()
    if (Test-Path $normLocation) {
        $normLocLower = $normLocation.TrimEnd('\').ToLower()
        $normInstallLoc = $normLocLower
        if (-not ($forbiddenFolders -contains $normLocLower)) {
            try {
                $fCount = (Get-ChildItem -Path $normLocation -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
                $fSize = (Get-ChildItem -Path $normLocation -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                $foundFileSystem.Add([PSCustomObject]@{
                    Type = "Folder"
                    Path = $normLocation
                    Description = "Diretório de Instalação original (arquivos remanescentes)"
                    ItemsCount = $fCount
                    SizeBytes = [int64]$fSize
                    Selected = $true
                })
            } catch {}
        }
    }
}

# 2. Varrer Pastas Comuns no Disco (incluindo explicitamente LOCALAPPDATA\Programs)
$foldersToScan = @(
    "$env:LOCALAPPDATA\Programs",
    "C:\Program Files",
    "C:\Program Files (x86)",
    "C:\ProgramData",
    "$env:APPDATA",
    "$env:LOCALAPPDATA"
)

foreach ($root in $foldersToScan) {
    if (-not (Test-Path $root)) { continue }
    
    # 2.1 Busca direta por termo
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

    # 2.2 Busca cruzada por Fabricante (ex: AppData\famatech\advanced_ip_scanner)
    foreach ($pub in $publisherTerms) {
        $pubFolder = Join-Path $root $pub
        if (Test-Path $pubFolder) {
            $normPub = $pubFolder.TrimEnd('\').ToLower()
            if (-not ($forbiddenFolders -contains $normPub)) {
                $subDirs = Get-ChildItem -Path $pubFolder -Directory -ErrorAction SilentlyContinue
                foreach ($sub in $subDirs) {
                    $isMatch = $false
                    foreach ($term in $searchTerms) {
                        if ($sub.Name.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                            $isMatch = $true
                            break
                        }
                    }
                    if ($isMatch -and (-not ($foundFileSystem.Path -contains $sub.FullName))) {
                        try {
                            $cCount = (Get-ChildItem -Path $sub.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
                            $cSize = (Get-ChildItem -Path $sub.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                            $foundFileSystem.Add([PSCustomObject]@{
                                Type = "Folder"
                                Path = $sub.FullName
                                Description = "Subpasta de Fabricante ($pub) em $root"
                                ItemsCount = $cCount
                                SizeBytes = [int64]$cSize
                                Selected = $true
                            })
                        } catch {}
                    }
                }
            }
        }
    }
}

# 3. Limpeza de Temporários de Instaladores Modernos (SquirrelTemp)
$squirrelTemp = "$env:LOCALAPPDATA\SquirrelTemp"
if (Test-Path $squirrelTemp) {
    $sqFiles = Get-ChildItem -Path $squirrelTemp -ErrorAction SilentlyContinue
    foreach ($sq in $sqFiles) {
        foreach ($term in $searchTerms) {
            if ($sq.Name.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                if (-not ($foundFileSystem.Path -contains $sq.FullName)) {
                    $foundFileSystem.Add([PSCustomObject]@{
                        Type = if ($sq.PSIsContainer) { "Folder" } else { "File" }
                        Path = $sq.FullName
                        Description = "Arquivo temporário residual de instalação Squirrel"
                        ItemsCount = 1
                        SizeBytes = if ($sq.PSIsContainer) { 0 } else { $sq.Length }
                        Selected = $true
                    })
                }
                break
            }
        }
    }
}

# 4. Varrer Pacotes de Loja / AppData\Local\Packages
$packagesDir = "$env:LOCALAPPDATA\Packages"
if (Test-Path $packagesDir) {
    foreach ($term in $searchTerms) {
        $matchedPkgs = Get-ChildItem -Path $packagesDir -Filter "*$term*" -Directory -ErrorAction SilentlyContinue
        foreach ($pkg in $matchedPkgs) {
            if (-not ($foundFileSystem.Path -contains $pkg.FullName)) {
                $foundFileSystem.Add([PSCustomObject]@{
                    Type = "Folder"
                    Path = $pkg.FullName
                    Description = "Dados residuais de pacote Windows Store / AppData"
                    ItemsCount = 1
                    SizeBytes = 0
                    Selected = $true
                })
            }
        }
    }
}

# 5. Varrer atalhos no Desktop e Menu Iniciar
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

# 6. Varrer Chaves de Software no Registro (HKCU, HKLM, WOW6432Node)
$regHives = @(
    "HKCU:\Software",
    "HKLM:\Software",
    "HKLM:\Software\Wow6432Node"
)

foreach ($hive in $regHives) {
    if (-not (Test-Path $hive)) { continue }
    
    # 6.1 Busca direta por termo
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
                        ValueName = ""
                        SubKeyCount = $keyObj.SubKeyCount
                        ValueCount = $keyObj.ValueCount
                        Description = "Chave de software em $hive"
                        Selected = $true
                    })
                }
            }
        }
    }

    # 6.2 Varredura Cruzada por Fabricante (ex: HKCU:\Software\famatech\advanced_ip_scanner)
    foreach ($pub in $publisherTerms) {
        $pubKey = Join-Path $hive $pub
        if (Test-Path $pubKey) {
            $childKeys = Get-ChildItem -Path $pubKey -ErrorAction SilentlyContinue
            foreach ($ck in $childKeys) {
                $isMatch = $false
                foreach ($term in $searchTerms) {
                    if ($ck.PSChildName.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                        $isMatch = $true
                        break
                    }
                }
                if ($isMatch) {
                    $normReg = $ck.Name.ToLower()
                    if (-not ($forbiddenKeys -contains $normReg)) {
                        $foundRegistry.Add([PSCustomObject]@{
                            Hive = $hive
                            KeyPath = $ck.Name
                            PSPath = $ck.PSPath
                            ParentKey = $pubKey
                            ValueName = ""
                            SubKeyCount = $ck.SubKeyCount
                            ValueCount = $ck.ValueCount
                            Description = "Subchave de fabricante ($pub) em $hive"
                            Selected = $true
                        })
                    }
                }
            }
        }
    }
}

# 7. Protocolos de URL e Classes (HKCU:\Software\Classes e HKLM:\Software\Classes)
$classesHives = @(
    "HKCU:\Software\Classes",
    "HKLM:\Software\Classes"
)

foreach ($cHive in $classesHives) {
    if (-not (Test-Path $cHive)) { continue }
    foreach ($term in $searchTerms) {
        # Procurar por chaves que comecem com o termo (ex: discord-*, steam, tg)
        $protoCandidates = Get-ChildItem -Path $cHive -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like "$term*" }
        foreach ($proto in $protoCandidates) {
            $isProtocolOrMatch = $false
            $protoProps = Get-ItemProperty -Path $proto.PSPath -ErrorAction SilentlyContinue
            if ($protoProps.'URL Protocol' -ne $null) {
                $isProtocolOrMatch = $true
            } elseif ($proto.PSChildName -match "^$term(-|_|\.|\$)") {
                $isProtocolOrMatch = $true
            }

            if ($isProtocolOrMatch) {
                $normReg = $proto.Name.ToLower()
                if (-not ($forbiddenKeys -contains $normReg)) {
                    $foundRegistry.Add([PSCustomObject]@{
                        Hive = $cHive
                        KeyPath = $proto.Name
                        PSPath = $proto.PSPath
                        ValueName = ""
                        SubKeyCount = $proto.SubKeyCount
                        ValueCount = $proto.ValueCount
                        Description = "Manipulador de Protocolo / Classe ($($proto.PSChildName))"
                        Selected = $true
                    })
                }
            }
        }

        # Checar Classes\Applications\<term>.exe
        $appClassKey = Join-Path "$cHive\Applications" "$term.exe"
        if (Test-Path $appClassKey) {
            $acObj = Get-Item -Path $appClassKey -ErrorAction SilentlyContinue
            if ($acObj) {
                $foundRegistry.Add([PSCustomObject]@{
                    Hive = $cHive
                    KeyPath = $acObj.Name
                    PSPath = $appClassKey
                    ValueName = ""
                    SubKeyCount = $acObj.SubKeyCount
                    ValueCount = $acObj.ValueCount
                    Description = "Associação de Aplicativo em Classes\Applications"
                    Selected = $true
                })
            }
        }
    }
}

# 8. App Paths (HKLM e HKCU CurrentVersion\App Paths)
$appPathsHives = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths",
    "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\App Paths"
)

$extraExeCands = [System.Collections.Generic.List[string]]::new()
if ($cleanName -like "*defrag*") {
    $extraExeCands.AddRange(@("df.exe", "df64.exe", "defraggler.exe", "defraggler64.exe"))
}
if ($InstallLocation -and (Test-Path $InstallLocation)) {
    $foundExes = Get-ChildItem -Path $InstallLocation -Filter "*.exe" -File -ErrorAction SilentlyContinue
    foreach ($fe in $foundExes) {
        if (-not $extraExeCands.Contains($fe.Name)) {
            $extraExeCands.Add($fe.Name)
        }
    }
}

foreach ($apHive in $appPathsHives) {
    if (-not (Test-Path $apHive)) { continue }
    foreach ($term in $searchTerms) {
        $cands = [System.Collections.Generic.List[string]]::new()
        $cands.Add("$term.exe")
        $cands.Add("$term")
        foreach ($extra in $extraExeCands) {
            if (-not $cands.Contains($extra)) { $cands.Add($extra) }
        }
        foreach ($c in $cands) {
            $targetAp = Join-Path $apHive $c
            if (Test-Path $targetAp) {
                $apObj = Get-Item -Path $targetAp -ErrorAction SilentlyContinue
                if ($apObj) {
                    $foundRegistry.Add([PSCustomObject]@{
                        Hive = $apHive
                        KeyPath = $apObj.Name
                        PSPath = $targetAp
                        ValueName = ""
                        SubKeyCount = $apObj.SubKeyCount
                        ValueCount = $apObj.ValueCount
                        Description = "Registro de Execução Rápida do Windows (App Paths - $c)"
                        Selected = $true
                    })
                }
            }
        }
    }
}

# 8.1 Checar substituição de utilitários do sistema (ex: ReplaceWindowsDefrag do Defraggler)
$specialSystemOverrides = @(
    @{ Path = "HKLM:\SOFTWARE\Microsoft\Dfrg"; Value = "ReplaceWindowsDefrag"; Desc = "Configuração de substituição do desfragmentador do Windows" },
    @{ Path = "HKCU:\Software\Microsoft\Dfrg"; Value = "ReplaceWindowsDefrag"; Desc = "Configuração de substituição do desfragmentador do Windows" }
)
foreach ($sso in $specialSystemOverrides) {
    if (Test-Path $sso.Path) {
        $prop = (Get-ItemProperty -Path $sso.Path -ErrorAction SilentlyContinue).($sso.Value)
        if ($prop -ne $null) {
            $foundRegistry.Add([PSCustomObject]@{
                Hive = "HKLM"
                KeyPath = "$($sso.Path) -> $($sso.Value)"
                PSPath = $sso.Path
                ValueName = $sso.Value
                SubKeyCount = 0
                ValueCount = 1
                Description = $sso.Desc
                Selected = $true
            })
        }
    }
}

# 9. Varrer Serviços Órfãos no Windows (CurrentControlSet\Services)
$servicesPath = "HKLM:\SYSTEM\CurrentControlSet\Services"
if (Test-Path $servicesPath) {
    foreach ($term in $searchTerms) {
        $svcKey = Join-Path $servicesPath $term
        if (Test-Path $svcKey) {
            $svcObj = Get-Item -Path $svcKey -ErrorAction SilentlyContinue
            if ($svcObj) {
                $foundRegistry.Add([PSCustomObject]@{
                    Hive = "HKLM"
                    KeyPath = $svcObj.Name
                    PSPath = $svcKey
                    ValueName = ""
                    SubKeyCount = $svcObj.SubKeyCount
                    ValueCount = $svcObj.ValueCount
                    Description = "Serviço do Windows residual ($term)"
                    Selected = $true
                })
            }
        }
    }
}

# 10. Varrer Inicialização Automática (Run / RunOnce)
$runPaths = @(
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Run"
)
foreach ($rPath in $runPaths) {
    if (Test-Path $rPath) {
        $rProps = Get-ItemProperty -Path $rPath -ErrorAction SilentlyContinue
        if ($rProps) {
            foreach ($prop in $rProps.PSObject.Properties) {
                $pName = [string]$prop.Name
                $pVal = [string]$prop.Value
                foreach ($term in $searchTerms) {
                    if ($pName.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or 
                        $pVal.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                        
                        $foundRegistry.Add([PSCustomObject]@{
                            Hive = $rPath
                            KeyPath = "$rPath -> $pName"
                            PSPath = $rPath
                            ValueName = $pName
                            SubKeyCount = 0
                            ValueCount = 1
                            Description = "Entrada residual de Inicialização do Windows (Run)"
                            Selected = $true
                        })
                        break
                    }
                }
            }
        }
    }
}

# 11. Varrer Registros de Compatibilidade, Telemetria e Cache do Explorer
$traceLocations = @(
    @{ Path = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store"; Desc = "Registro de Compatibilidade do Windows" },
    @{ Path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage\AppSwitched"; Desc = "Histórico de Execução de Janelas do Explorer" },
    @{ Path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage\ShowJumpView"; Desc = "Histórico de Atalhos do Menu Iniciar" },
    @{ Path = "HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache"; Desc = "Cache de Interface do Shell do Windows" },
    @{ Path = "HKCU:\Software\Microsoft\Windows\ShellNoRoam\MUICache"; Desc = "Cache ShellNoRoam do Windows" },
    @{ Path = "HKLM:\SOFTWARE\Microsoft\Windows\ShellNoRoam\MUICache"; Desc = "Cache ShellNoRoam da Máquina" }
)

foreach ($loc in $traceLocations) {
    $p = $loc.Path
    if (Test-Path $p) {
        $props = Get-ItemProperty -Path $p -ErrorAction SilentlyContinue
        if ($props) {
            foreach ($prop in $props.PSObject.Properties) {
                $pName = [string]$prop.Name
                $pVal = [string]$prop.Value
                foreach ($term in $searchTerms) {
                    if ($pName.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or 
                        $pVal.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                        
                        $foundRegistry.Add([PSCustomObject]@{
                            Hive = "HKCU"
                            KeyPath = "$p -> $pName"
                            PSPath = $p
                            ValueName = $pName
                            SubKeyCount = 0
                            ValueCount = 1
                            Description = $loc.Desc
                            Selected = $true
                        })
                        break
                    }
                }
            }
        }
    }
}

# 12. Regras de Firewall do Windows
try {
    $appFilters = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
    if ($appFilters) {
        foreach ($af in $appFilters) {
            $prog = [string]$af.Program
            if (-not $prog) { continue }
            $isMatch = $false

            if ($normInstallLoc -and $prog.ToLower().StartsWith($normInstallLoc)) {
                $isMatch = $true
            } else {
                foreach ($term in $searchTerms) {
                    if ($prog.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                        $isMatch = $true
                        break
                    }
                }
            }

            if ($isMatch) {
                $ruleObj = Get-NetFirewallRule -Name $af.InstanceID -ErrorAction SilentlyContinue
                $ruleName = if ($ruleObj) { $ruleObj.DisplayName } else { $af.InstanceID }
                $foundFirewall.Add([PSCustomObject]@{
                    Name = $af.InstanceID
                    DisplayName = $ruleName
                    Program = $prog
                    Description = "Regra de Firewall do Windows apontando para executável residual"
                    Selected = $true
                })
            }
        }
    }
} catch {}

# 13. Checar se a chave do Uninstall ainda existe
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
                    ValueName = ""
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
    FirewallRulesLeftovers = $foundFirewall
    TotalRegistryCount = $foundRegistry.Count
    TotalFileSystemCount = $foundFileSystem.Count
    TotalFirewallCount = $foundFirewall.Count
    TotalSizeBytes = ($foundFileSystem | Measure-Object -Property SizeBytes -Sum).Sum
}

$result | ConvertTo-Json -Depth 4 -Compress
