param(
    [Parameter(Mandatory=$true)]
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

# 1. Criar Ponto de Restauração Preventivo
try {
    Checkpoint-Computer -Description "Queu Ponto Limpeza Residuos Orfaos" -RestorePointType "MODIFY_SETTINGS" -ErrorAction SilentlyContinue
} catch {}

$data = $ItemsJson | ConvertFrom-Json
$removedItems = [System.Collections.Generic.List[string]]::new()
$errors = [System.Collections.Generic.List[string]]::new()
$freedBytes = [int64]0

foreach ($item in $data) {
    $p = $item.Path
    if (-not $p) { continue }
    $type = $item.Type

    if ($type -eq "RegistryAppPath" -or $type -eq "RegistryKey") {
        # Limpeza de Registro
        if (Test-Path $p) {
            $normKey = $p.ToLower()
            $isForbidden = $false
            foreach ($fk in $forbiddenKeys) {
                if ($normKey.Contains($fk)) {
                    $isForbidden = $true
                    break
                }
            }

            if ($isForbidden) {
                $errors.Add("Proteção de Segurança: Impedida a exclusão de chave mestre: $p")
                continue
            }

            try {
                Remove-Item -Path $p -Recurse -Force -ErrorAction Stop
                $removedItems.Add($p)
            } catch {
                $errors.Add("Erro ao remover chave $p : $($_.Exception.Message)")
            }
        }
    } else {
        # Limpeza de Pastas e Arquivos no Disco
        $normP = $p.TrimEnd('\').ToLower()
        if ($forbiddenFolders -contains $normP) {
            $errors.Add("Proteção de Segurança: Impedida a exclusão de pasta crítica: $p")
            continue
        }

        if (Test-Path $p) {
            $size = [int64]($item.SizeBytes)
            try {
                $isDir = (Get-Item $p) -is [System.IO.DirectoryInfo]
                if ($isDir) {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
                } else {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
                }
                $removedItems.Add("$p (enviado à Lixeira)")
                $freedBytes += $size
            } catch {
                # Fallback para exclusão direta
                try {
                    Remove-Item -Path $p -Recurse -Force -ErrorAction Stop
                    $removedItems.Add($p)
                    $freedBytes += $size
                } catch {
                    $errors.Add("Erro ao excluir arquivo/pasta $p : $($_.Exception.Message)")
                }
            }
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
