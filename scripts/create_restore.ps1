param(
    [string]$Description = "Queu Uninstaller"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    # Tenta habilitar proteção caso necessário
    Enable-ComputerRestore -Drive "C:\" -ErrorAction SilentlyContinue

    $res = Checkpoint-Computer -Description $Description -RestorePointType "APPLICATION_UNINSTALL" -ErrorAction Stop
    [PSCustomObject]@{
        Success = $true
        Message = "Ponto de restauração '$Description' criado com sucesso!"
    } | ConvertTo-Json -Compress
} catch {
    [PSCustomObject]@{
        Success = $false
        Message = "Não foi possível criar o ponto de restauração: $($_.Exception.Message)"
    } | ConvertTo-Json -Compress
}
