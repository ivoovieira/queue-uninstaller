param(
    [Parameter(Mandatory=$true)]
    [string]$ItemsJson
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

$data = $ItemsJson | ConvertFrom-Json

$removedFiles = [System.Collections.Generic.List[string]]::new()
$removedRegistry = [System.Collections.Generic.List[string]]::new()
$errors = [System.Collections.Generic.List[string]]::new()

# Deletar arquivos e pastas
if ($data.FileSystemLeftovers) {
    foreach ($item in $data.FileSystemLeftovers) {
        $p = $item.Path
        if (-not $p) { continue }
        $normP = $p.TrimEnd('\').ToLower()
        if ($forbiddenFolders -contains $normP) {
            $errors.Add("Proteção de Segurança: Impedida a exclusão de pasta do sistema: $p")
            continue
        }

        if (Test-Path $p) {
            try {
                Remove-Item -Path $p -Recurse -Force -ErrorAction Stop
                $removedFiles.Add($p)
            } catch {
                $errors.Add("Falha ao remover arquivo/pasta $p : $($_.Exception.Message)")
            }
        }
    }
}

# Deletar chaves e valores do registro
if ($data.RegistryLeftovers) {
    foreach ($reg in $data.RegistryLeftovers) {
        $psPath = $reg.PSPath
        if (-not $psPath) { continue }
        $valName = $reg.ValueName

        # Se for um valor específico (AppCompatFlags, FeatureUsage, MuiCache, etc.)
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

$output = [PSCustomObject]@{
    Success = $true
    RemovedFilesCount = $removedFiles.Count
    RemovedRegistryCount = $removedRegistry.Count
    RemovedFiles = $removedFiles
    RemovedRegistry = $removedRegistry
    Errors = $errors
}

$output | ConvertTo-Json -Depth 3 -Compress
