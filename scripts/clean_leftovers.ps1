param(
    [Parameter(Mandatory=$true)]
    [string]$ItemsJson,

    [Parameter(Mandatory=$false)]
    [switch]$UseRecycleBin = $true
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue

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

$data = $ItemsJson | ConvertFrom-Json

$removedFiles = [System.Collections.Generic.List[string]]::new()
$removedRegistry = [System.Collections.Generic.List[string]]::new()
$removedFirewall = [System.Collections.Generic.List[string]]::new()
$errors = [System.Collections.Generic.List[string]]::new()

function Remove-ResidualFileSystemItem($targetPath) {
    if (-not (Test-Path $targetPath)) { return $null }

    # 1. Se contiver DLLs ou for uma DLL, desregistrar do Explorer via regsvr32
    $isDir = (Get-Item -LiteralPath $targetPath) -is [System.IO.DirectoryInfo]
    if ($isDir) {
        $dlls = Get-ChildItem -LiteralPath $targetPath -Filter "*.dll" -Recurse -File -ErrorAction SilentlyContinue
        foreach ($dll in $dlls) {
            try {
                Start-Process -FilePath "regsvr32.exe" -ArgumentList "/u", "/s", "`"$($dll.FullName)`"" -Wait -NoNewWindow -ErrorAction SilentlyContinue
            } catch {}
        }
    } elseif ($targetPath -like "*.dll") {
        try {
            Start-Process -FilePath "regsvr32.exe" -ArgumentList "/u", "/s", "`"$targetPath`"" -Wait -NoNewWindow -ErrorAction SilentlyContinue
        } catch {}
    }

    # 2. Tentar exclusão segura via Lixeira
    try {
        if ($isDir) {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($targetPath, 'OnlyErrorDialogs', 'SendToRecycleBin')
        } else {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($targetPath, 'OnlyErrorDialogs', 'SendToRecycleBin')
        }
        return "enviado à Lixeira"
    } catch {
        # 3. Fallback para exclusão direta
        try {
            Remove-Item -Path $targetPath -Recurse -Force -ErrorAction Stop
            return "excluído diretamente"
        } catch {
            $firstErr = $_.Exception.Message
            # 4. Se falhar por bloqueio de arquivo (Explorer lock / Shell extension), reiniciar momentaneamente explorer.exe
            try {
                Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 800
                Start-Process explorer.exe -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 1000

                Remove-Item -Path $targetPath -Recurse -Force -ErrorAction Stop
                return "excluído após desbloqueio do Explorer"
            } catch {
                # 5. Se ainda estiver travado, agendar exclusão no próximo boot (PendingFileRenameOperations)
                try {
                    $sessionMgr = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager"
                    if (Test-Path $sessionMgr) {
                        $existing = (Get-ItemProperty -Path $sessionMgr -Name "PendingFileRenameOperations" -ErrorAction SilentlyContinue).PendingFileRenameOperations
                        $pfrList = [System.Collections.Generic.List[string]]::new()
                        if ($existing) { $pfrList.AddRange($existing) }
                        $pfrList.Add("\??\$targetPath")
                        $pfrList.Add("")
                        Set-ItemProperty -Path $sessionMgr -Name "PendingFileRenameOperations" -Value $pfrList.ToArray() -Type MultiString -Force -ErrorAction SilentlyContinue
                        return "agendado para exclusão no próximo boot"
                    }
                } catch {}
                throw [System.Exception]::new("Arquivo travado ($firstErr) : $($_.Exception.Message)")
            }
        }
    }
}

# 1. Deletar arquivos e pastas (com envio seguro para a Lixeira e liberação de DLLs)
if ($data.FileSystemLeftovers) {
    foreach ($item in $data.FileSystemLeftovers) {
        $p = $item.Path
        if (-not $p) { continue }
        $normP = $p.TrimEnd('\').ToLower()
        if ($forbiddenFolders -contains $normP) {
            $errors.Add("Proteção de Segurança: Impedida a exclusão de pasta crítica do sistema: $p")
            continue
        }

        if (Test-Path $p) {
            try {
                $statusMsg = Remove-ResidualFileSystemItem $p
                if ($statusMsg) {
                    $removedFiles.Add("$p ($statusMsg)")
                }

                # Se a pasta-mãe de fabricante ficou órfã e vazia, removê-la com segurança
                $parentDir = Split-Path -Path $p -Parent
                if ($parentDir -and (Test-Path $parentDir)) {
                    $normParent = $parentDir.TrimEnd('\').ToLower()
                    if (-not ($forbiddenFolders -contains $normParent)) {
                        $remaining = Get-ChildItem -Path $parentDir -Force -ErrorAction SilentlyContinue
                        if (-not $remaining -or $remaining.Count -eq 0) {
                            try {
                                Remove-Item -Path $parentDir -Force -Recurse -ErrorAction SilentlyContinue
                                $removedFiles.Add("$parentDir (pasta de fabricante vazia limpa)")
                            } catch {}
                        }
                    }
                }
            } catch {
                $errors.Add("Falha ao remover arquivo/pasta $p : $($_.Exception.Message)")
            }
        }
    }
}

# 2. Deletar chaves e valores do registro
if ($data.RegistryLeftovers) {
    foreach ($reg in $data.RegistryLeftovers) {
        $psPath = $reg.PSPath
        if (-not $psPath) { continue }
        $valName = $reg.ValueName

        # Se for um valor específico (AppCompatFlags, FeatureUsage, MuiCache, Run, etc.)
        if ($valName -and ($valName.Trim() -ne "")) {
            if (Test-Path $psPath) {
                try {
                    Remove-ItemProperty -Path $psPath -Name $valName -Force -ErrorAction Stop
                    $removedRegistry.Add("$psPath -> $valName")
                } catch {
                    $errors.Add("Falha ao remover valor do registro $valName em $psPath : $($_.Exception.Message)")
                }
            }
        } else {
            # Se for a chave inteira
            $keyName = $reg.KeyPath
            if ($keyName -and ($forbiddenKeys -contains $keyName.ToLower())) {
                $errors.Add("Proteção de Segurança: Impedida a exclusão de chave mestra do registro: $keyName")
                continue
            }

            if (Test-Path $psPath) {
                try {
                    Remove-Item -Path $psPath -Recurse -Force -ErrorAction Stop
                    $removedRegistry.Add($psPath)

                    # Verificar chave-mãe de fabricante: se ficou com 0 subchaves e 0 valores, remove
                    $parentRegKey = $reg.ParentKey
                    if (-not $parentRegKey) {
                        $parentRegKey = Split-Path -Path $psPath -Parent
                    }
                    if ($parentRegKey -and (Test-Path $parentRegKey)) {
                        $normParentKey = $parentRegKey.ToLower()
                        if (-not ($forbiddenKeys -contains $normParentKey)) {
                            $parentObj = Get-Item -Path $parentRegKey -ErrorAction SilentlyContinue
                            if ($parentObj -and $parentObj.SubKeyCount -eq 0 -and $parentObj.ValueCount -eq 0) {
                                try {
                                    Remove-Item -Path $parentRegKey -Force -ErrorAction SilentlyContinue
                                    $removedRegistry.Add("$parentRegKey (chave de fabricante vazia limpa)")
                                } catch {}
                            }
                        }
                    }
                } catch {
                    $errors.Add("Falha ao remover chave do registro $psPath : $($_.Exception.Message)")
                }
            }
        }
    }
}

# 3. Remover Regras de Firewall Órfãs
if ($data.FirewallRulesLeftovers) {
    foreach ($rule in $data.FirewallRulesLeftovers) {
        $rName = $rule.Name
        if (-not $rName) { continue }
        try {
            Remove-NetFirewallRule -Name $rName -ErrorAction Stop
            $removedFirewall.Add($rule.DisplayName)
        } catch {
            $errors.Add("Falha ao remover regra de firewall $rName : $($_.Exception.Message)")
        }
    }
}

$output = [PSCustomObject]@{
    Success = $true
    RemovedFilesCount = $removedFiles.Count
    RemovedRegistryCount = $removedRegistry.Count
    RemovedFirewallCount = $removedFirewall.Count
    RemovedFiles = $removedFiles
    RemovedRegistry = $removedRegistry
    RemovedFirewall = $removedFirewall
    Errors = $errors
}

$output | ConvertTo-Json -Depth 3 -Compress
