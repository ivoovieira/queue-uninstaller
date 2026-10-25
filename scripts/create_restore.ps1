param([string]$Description = "Queu Uninstaller")
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    # 1. Garante que a proteção do sistema esteja ativa no disco C:
    Enable-ComputerRestore -Drive "C:\" -ErrorAction SilentlyContinue

    # 2. Desativa a trava de frequência de 24h (1440 min) do Windows 10/11
    Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore" -Name "SystemRestorePointCreationFrequency" -Value 0 -Force -ErrorAction SilentlyContinue

    # 3. Tenta criar via Checkpoint-Computer
    try {
        $res = Checkpoint-Computer -Description $Description -RestorePointType "APPLICATION_UNINSTALL" -ErrorAction Stop
        [PSCustomObject]@{ Success = $true; Message = "Ponto de restauração '$Description' criado com sucesso!" } | ConvertTo-Json -Compress
        exit 0
    } catch {
        # Fallback via classe WMI nativa
        $sysRestore = [wmiclass]"\\localhost\root\default:systemrestore"
        $wmiRes = $sysRestore.CreateRestorePoint($Description, 1, 100)
        if ($wmiRes.ReturnValue -eq 0) {
            [PSCustomObject]@{ Success = $true; Message = "Ponto de restauração '$Description' criado com sucesso via WMI!" } | ConvertTo-Json -Compress
            exit 0
        } else {
            throw "Código WMI de retorno: $($wmiRes.ReturnValue)"
        }
    }
} catch {
    [PSCustomObject]@{
        Success = $false
        Message = "Não foi possível criar o ponto de restauração: $($_.Exception.Message)"
    } | ConvertTo-Json -Compress
    exit 1
}
