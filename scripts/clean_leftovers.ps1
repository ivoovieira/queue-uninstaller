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

# 1. Deletar arquivos e pastas (com envio seguro para a Lixeira)
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
                $isDir = (Get-Item $p) -is [System.IO.DirectoryInfo]
                if ($isDir) {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
                } else {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
                }
                $removedFiles.Add("$p (enviado à Lixeira)")
            } catch {
                # Fallback para exclusão direta se a Lixeira falhar
                try {
                    Remove-Item -Path $p -Recurse -Force -ErrorAction Stop
                    $removedFiles.Add($p)
                } catch {
                    $errors.Add("Falha ao remover arquivo/pasta $p : $($_.Exception.Message)")
                }
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
