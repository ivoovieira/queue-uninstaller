param(
    [Parameter(Mandatory=$false)]
    [string]$InstallLocation = "",

    [Parameter(Mandatory=$false)]
    [string]$DisplayName = "",

    [Parameter(Mandatory=$false)]
    [string]$UninstallString = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$protectedExes = @(
    "explorer.exe", "svchost.exe", "powershell.exe", "pwsh.exe", "cmd.exe",
    "node.exe", "electron.exe", "queuuninstaller.exe", "system", "idle",
    "services.exe", "lsass.exe", "csrss.exe", "smss.exe", "wininit.exe",
    "winlogon.exe", "spoolsv.exe", "taskhostw.exe", "dwm.exe", "sihost.exe",
    "ctfmon.exe", "conhost.exe"
) | ForEach-Object { $_.ToLower() }

$killed = [System.Collections.Generic.List[object]]::new()

$normLoc = if ($InstallLocation) {
    $InstallLocation.Trim('"').Trim().TrimEnd('\').ToLower()
} else { "" }

# Extrair nomes de executáveis candidatos a partir de DisplayName e UninstallString
$candidateExes = [System.Collections.Generic.List[string]]::new()

if ($DisplayName) {
    $cleanD = ($DisplayName -replace '[^a-zA-Z0-9]', '').ToLower()
    if ($cleanD.Length -ge 3) {
        $candidateExes.Add("$cleanD.exe")
    }
    $firstWord = ($DisplayName.Trim().Split(' ')[0] -replace '[^a-zA-Z0-9]', '').ToLower()
    if ($firstWord.Length -ge 3 -and -not $candidateExes.Contains("$firstWord.exe")) {
        $candidateExes.Add("$firstWord.exe")
    }
}

if ($UninstallString) {
    if ($UninstallString -match '([a-zA-Z0-9_\-\.]+\.exe)') {
        $uExe = $Matches[1].ToLower()
        # Não matar o próprio desinstalador unins000 ou uninstall
        if ($uExe -notmatch '^unins' -and $uExe -notmatch '^setup' -and -not $candidateExes.Contains($uExe)) {
            $candidateExes.Add($uExe)
        }
    }
}

try {
    $allProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    foreach ($proc in $allProcesses) {
        $pName = [string]$proc.Name.ToLower()
        if ($protectedExes -contains $pName) { continue }

        $pPath = [string]$proc.ExecutablePath
        $pCmd = [string]$proc.CommandLine
        $isMatch = $false

        # 1. Match por caminho do executável dentro de InstallLocation
        if ($normLoc -and $pPath) {
            $normPPath = $pPath.ToLower()
            if ($normPPath.StartsWith($normLoc)) {
                $isMatch = $true
            }
        }

        # 2. Match por CommandLine contendo InstallLocation
        if (-not $isMatch -and $normLoc -and $pCmd) {
            if ($pCmd.ToLower().Contains($normLoc)) {
                $isMatch = $true
            }
        }

        # 3. Match por nomes de executável candidato
        if (-not $isMatch -and $candidateExes.Contains($pName)) {
            $isMatch = $true
        }

        if ($isMatch) {
            try {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
                $killed.Add([PSCustomObject]@{
                    ProcessId = $proc.ProcessId
                    Name = $proc.Name
                    Path = $proc.ExecutablePath
                })
            } catch {
                # Fallback taskkill
                try {
                    & taskkill /f /pid $proc.ProcessId | Out-Null
                    $killed.Add([PSCustomObject]@{
                        ProcessId = $proc.ProcessId
                        Name = $proc.Name
                        Path = $proc.ExecutablePath
                    })
                } catch {}
            }
        }
    }
} catch {}

[PSCustomObject]@{
    Success = $true
    KilledCount = $killed.Count
    KilledProcesses = $killed
} | ConvertTo-Json -Depth 3 -Compress
