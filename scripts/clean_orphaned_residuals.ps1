param(
    [Parameter(Mandatory=$false)]
    [string]$JsonPath,

    [Parameter(Mandatory=$false)]
    [string]$ItemsJson
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue

$forbiddenFolders = @(
    "C:\", "C:\Windows", "C:\Windows\System32", "C:\Program Files", "C:\Program Files (x86)",
    "C:\ProgramData", "C:\Users", "$env:USERPROFILE", "$env:APPDATA", "$env:LOCALAPPDATA",
    "$env:LOCALAPPDATA\Programs", "$env:TEMP", "C:\Users\Public", "C:\Users\Default"
) | ForEach-Object { $_.TrimEnd('\').ToLower() }

$forbiddenKeys = @(
    "HKEY_LOCAL_MACHINE", "HKLM:",
    "HKEY_CURRENT_USER", "HKCU:",
    "HKEY_LOCAL_MACHINE\Software", "HKLM:\Software",
    "HKEY_LOCAL_MACHINE\Software\Microsoft", "HKLM:\Software\Microsoft",
    "HKEY_LOCAL_MACHINE\Software\Microsoft\Windows", "HKLM:\Software\Microsoft\Windows",
    "HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion", "HKLM:\Software\Microsoft\Windows\CurrentVersion",
    "HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\App Paths", "HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths",
    "HKEY_CURRENT_USER\Software", "HKCU:\Software",
    "HKEY_CURRENT_USER\Software\Microsoft", "HKCU:\Software\Microsoft",
    "HKEY_CURRENT_USER\Software\Microsoft\Windows", "HKCU:\Software\Microsoft\Windows",
    "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion", "HKCU:\Software\Microsoft\Windows\CurrentVersion",
    "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\App Paths", "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths",
    "HKEY_LOCAL_MACHINE\Software\Wow6432Node", "HKLM:\Software\Wow6432Node",
    "HKEY_LOCAL_MACHINE\Software\Wow6432Node\Microsoft", "HKLM:\Software\Wow6432Node\Microsoft",
    "HKEY_LOCAL_MACHINE\Software\Wow6432Node\Microsoft\Windows", "HKLM:\Software\Wow6432Node\Microsoft\Windows",
    "HKEY_LOCAL_MACHINE\Software\Wow6432Node\Microsoft\Windows\CurrentVersion", "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion",
    "HKEY_LOCAL_MACHINE\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\App Paths", "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\App Paths",
    "HKEY_LOCAL_MACHINE\SYSTEM", "HKLM:\SYSTEM",
    "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet", "HKLM:\SYSTEM\CurrentControlSet",
    "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services", "HKLM:\SYSTEM\CurrentControlSet\Services",
    "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum", "HKLM:\SYSTEM\CurrentControlSet\Enum",
    "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control", "HKLM:\SYSTEM\CurrentControlSet\Control",
    "HKEY_CURRENT_USER\Software\Classes", "HKCU:\Software\Classes",
    "HKEY_LOCAL_MACHINE\Software\Classes", "HKLM:\Software\Classes"
) | ForEach-Object { $_.TrimEnd('\').ToLower() }

# 1. Criar Ponto de Restauração Preventivo
try {
    Checkpoint-Computer -Description "Queu Ponto Limpeza Residuos Orfaos" -RestorePointType "MODIFY_SETTINGS" -ErrorAction SilentlyContinue
} catch {}

$data = @()
if ($JsonPath -and (Test-Path -LiteralPath $JsonPath)) {
    try {
        $raw = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8
        $data = $raw | ConvertFrom-Json
    } catch {
        $raw = [System.IO.File]::ReadAllText($JsonPath, [System.Text.Encoding]::UTF8)
        $data = $raw | ConvertFrom-Json
    }
} elseif ($ItemsJson) {
    $data = $ItemsJson | ConvertFrom-Json
}
if ($data -isnot [System.Array] -and $data -isnot [System.Collections.IEnumerable]) {
    $data = @($data)
}

$removedItems = [System.Collections.Generic.List[string]]::new()
$errors = [System.Collections.Generic.List[string]]::new()
$freedBytes = [int64]0

foreach ($item in $data) {
    $p = $item.Path
    if (-not $p) { continue }
    $type = $item.Type

    if ($type -eq "RegistryAppPath" -or $type -eq "RegistryKey") {
        # Limpeza de Registro
        $targetReg = $p
        if ((-not (Test-Path -LiteralPath $targetReg)) -and ($targetReg -match '^HKEY_')) {
            $targetReg = "Registry::$targetReg"
        }

        # Validação de Segurança Estrita: Não apagar chaves mestras raiz
        $cleanNorm = ($p -replace '^(Microsoft\.PowerShell\.Core\\)?Registry::', '').TrimEnd('\').ToLower()
        $cleanNormExpanded = $cleanNorm -replace '^hklm:\\', 'hkey_local_machine\' -replace '^hkcu:\\', 'hkey_current_user\'

        $isMasterRoot = $false
        foreach ($fk in $forbiddenKeys) {
            $fkNorm = $fk -replace '^hklm:\\', 'hkey_local_machine\' -replace '^hkcu:\\', 'hkey_current_user\'
            if ($cleanNorm -eq $fk -or $cleanNormExpanded -eq $fkNorm) {
                $isMasterRoot = $true
                break
            }
        }

        if ($isMasterRoot) {
            $errors.Add("Proteção de Segurança: Impedida a exclusão de chave mestre: $p")
            continue
        }

        if (Test-Path -LiteralPath $targetReg) {
            try {
                Remove-Item -LiteralPath $targetReg -Recurse -Force -ErrorAction Stop
                $removedItems.Add($p)
            } catch {
                $errors.Add("Erro ao remover chave $p : $($_.Exception.Message)")
            }
        } else {
            $removedItems.Add("$p (já inexistente)")
        }
    } else {
        # Limpeza de Pastas e Arquivos no Disco
        $normP = $p.TrimEnd('\').ToLower()
        if ($forbiddenFolders -contains $normP) {
            $errors.Add("Proteção de Segurança: Impedida a exclusão de pasta crítica: $p")
            continue
        }

        if (Test-Path -LiteralPath $p) {
            $size = [int64]($item.SizeBytes)
            try {
                $isDir = (Get-Item -LiteralPath $p) -is [System.IO.DirectoryInfo]
                if ($isDir) {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
                } else {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
                }
                $removedItems.Add("$p (enviado à Lixeira)")
                $freedBytes += $size
            } catch {
                # Fallback para exclusão direta se mover para lixeira falhar
                try {
                    Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop
                    $removedItems.Add($p)
                    $freedBytes += $size
                } catch {
                    $errors.Add("Erro ao excluir arquivo/pasta $p : $($_.Exception.Message)")
                }
            }
        } else {
            $removedItems.Add("$p (já inexistente)")
        }
    }
}

$output = [PSCustomObject]@{
    Success = $true
    RemovedCount = $removedItems.Count
    RemovedBytes = $freedBytes
    RemovedItems = $removedItems
    Errors = $errors
}

$output | ConvertTo-Json -Depth 3 -Compress
