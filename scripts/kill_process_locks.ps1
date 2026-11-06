# =================================================================
# SCRIPT: Encerramento Preventivo e Resiliente de Processos Bloqueadores
# Identificador: kill_process_locks.ps1
# Objetivo: Identificar e encerrar árvores de processos ativas associadas a um
#           software antes ou durante a desinstalação, incluindo suporte a manifestos
#           AppX/MSIX, aliases cruzados e processos em sessões desconectadas.
# Entradas:
#   - $InstallLocation (string): Diretório de instalação do aplicativo
#   - $DisplayName (string): Nome amigável de exibição registrado no Windows
#   - $UninstallString (string): Linha de comando de desinstalação
#   - $PackageFullName (string): Identificador completo do pacote AppX
#   - $PackageFamilyName (string): Família do pacote AppX
# Retornos: JSON com { Success: bool, KilledCount: int, KilledProcesses: Array }
# =================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$InstallLocation = "",

    [Parameter(Mandatory=$false)]
    [string]$DisplayName = "",

    [Parameter(Mandatory=$false)]
    [string]$UninstallString = "",

    [Parameter(Mandatory=$false)]
    [string]$PackageFullName = "",

    [Parameter(Mandatory=$false)]
    [string]$PackageFamilyName = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# -----------------------------------------------------------------
# 1. LISTA DE PROCESSOS PROTEGIDOS (WHITELIST DE SEGURANÇA)
# -----------------------------------------------------------------
# Nota didática: Processos de sistema, shell do Windows e do próprio Queu Uninstaller
# jamais devem ser encerrados, prevenindo instabilidade do sistema ou encerramento do agente.
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

$candidateExes = [System.Collections.Generic.List[string]]::new()

# -----------------------------------------------------------------
# 2. INFERÊNCIA DE NOMES DE EXECUTÁVEIS CANDIDATOS
# -----------------------------------------------------------------

# 2.1 A partir do DisplayName
if ($DisplayName) {
    $cleanD = ($DisplayName -replace '[^a-zA-Z0-9]', '').ToLower()
    if ($cleanD.Length -ge 3 -and -not $candidateExes.Contains("$cleanD.exe")) {
        $candidateExes.Add("$cleanD.exe")
    }
    $firstWord = ($DisplayName.Trim().Split(' ')[0] -replace '[^a-zA-Z0-9]', '').ToLower()
    if ($firstWord.Length -ge 3 -and -not $candidateExes.Contains("$firstWord.exe")) {
        $candidateExes.Add("$firstWord.exe")
    }
}

# 2.2 A partir de comandos em UninstallString
if ($UninstallString) {
    if ($UninstallString -match '([a-zA-Z0-9_\-\.]+\.exe)') {
        $uExe = $Matches[1].ToLower()
        if ($uExe -notmatch '^unins' -and $uExe -notmatch '^setup' -and -not $candidateExes.Contains($uExe)) {
            $candidateExes.Add($uExe)
        }
    }
}

# 2.3 Extração a partir do AppxManifest.xml (Apps da Microsoft Store / Windows)
# Nota didática: Pacotes como OpenAI.Codex possuem DisplayName 'Codex', mas o executável
# real declarado em <Application Executable="..."> é 'app/ChatGPT.exe'.
$manifestLocations = @()
if ($InstallLocation) {
    $manifestLocations += (Join-Path $InstallLocation "AppxManifest.xml")
}
if ($PackageFullName) {
    $manifestLocations += "C:\Program Files\WindowsApps\$PackageFullName\AppxManifest.xml"
}
foreach ($mPath in $manifestLocations) {
    if (Test-Path -LiteralPath $mPath) {
        try {
            [xml]$mXml = Get-Content -LiteralPath $mPath -Raw -ErrorAction SilentlyContinue
            if ($mXml.Package.Applications.Application) {
                foreach ($appNode in $mXml.Package.Applications.Application) {
                    $exeAttr = [string]$appNode.Executable
                    if ($exeAttr) {
                        $baseExe = [System.IO.Path]::GetFileName($exeAttr).ToLower()
                        if ($baseExe -and -not $candidateExes.Contains($baseExe)) {
                            $candidateExes.Add($baseExe)
                        }
                    }
                }
            }
        } catch {}
    }
}

# 2.4 Executáveis existentes fisicamente no diretório de instalação
if ($InstallLocation -and (Test-Path -LiteralPath $InstallLocation)) {
    try {
        $foundExes = Get-ChildItem -Path $InstallLocation -Filter "*.exe" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
        foreach ($fe in $foundExes) {
            $feLower = $fe.ToLower()
            if ($feLower -and -not $candidateExes.Contains($feLower)) {
                $candidateExes.Add($feLower)
            }
        }
    } catch {}
}

# 2.5 Dicionário de Aliases e Sinônimos de Softwares Populares
# Nota didática: Softwares empacotados sob nomes corporativos (ex: OpenAI.Codex x ChatGPT,
# WhatsApp Desktop x WhatsApp.Root) frequentemente executam com nomes discrepantes do pacote.
$searchTarget = "$DisplayName $PackageFullName $PackageFamilyName $UninstallString $InstallLocation".ToLower()

if ($searchTarget -match 'codex|openai|chatgpt') {
    @("chatgpt.exe", "codex.exe", "codex-command-runner.exe") | ForEach-Object {
        if (-not $candidateExes.Contains($_)) { $candidateExes.Add($_) }
    }
}
if ($searchTarget -match 'whatsapp') {
    @("whatsapp.exe", "whatsapp.root.exe") | ForEach-Object {
        if (-not $candidateExes.Contains($_)) { $candidateExes.Add($_) }
    }
}
if ($searchTarget -match 'teams') {
    @("teams.exe", "ms-teams.exe") | ForEach-Object {
        if (-not $candidateExes.Contains($_)) { $candidateExes.Add($_) }
    }
}
if ($searchTarget -match 'discord') {
    @("discord.exe") | ForEach-Object {
        if (-not $candidateExes.Contains($_)) { $candidateExes.Add($_) }
    }
}

# -----------------------------------------------------------------
# 3. LOCALIZAÇÃO E ENCERRAMENTO VIA WMI / CIM
# -----------------------------------------------------------------
try {
    $allProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    foreach ($proc in $allProcesses) {
        $pName = [string]$proc.Name.ToLower()
        if ($protectedExes -contains $pName) { continue }

        $pPath = [string]$proc.ExecutablePath
        $pCmd = [string]$proc.CommandLine
        $isMatch = $false

        # Match 1: Caminho do executável dentro da pasta de instalação
        if ($normLoc -and $pPath) {
            $normPPath = $pPath.ToLower()
            if ($normPPath.StartsWith($normLoc)) {
                $isMatch = $true
            }
        }

        # Match 2: Linha de comando contendo a pasta de instalação
        if (-not $isMatch -and $normLoc -and $pCmd) {
            if ($pCmd.ToLower().Contains($normLoc)) {
                $isMatch = $true
            }
        }

        # Match 3: Nome do executável presente na lista de candidatos
        # Nota didática: Para processos em outras sessões ou em sandbox, o WMI retorna
        # ExecutablePath e CommandLine nulos por restrição de permissão. O match pelo
        # Name da imagem garante a detecção mesmo nessas condições.
        if (-not $isMatch -and $candidateExes.Contains($pName)) {
            $isMatch = $true
        }

        if ($isMatch) {
            # Encerramento forçado em árvore (processo pai e todos os filhos)
            try {
                & taskkill /f /t /pid $proc.ProcessId 2>$null | Out-Null
                $killed.Add([PSCustomObject]@{
                    ProcessId = $proc.ProcessId
                    Name = $proc.Name
                    Path = $proc.ExecutablePath
                })
            } catch {
                try {
                    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
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

# -----------------------------------------------------------------
# 4. VARREDURA COMPLEMENTAR MULTI-SESSÃO VIA TASKKILL POR IMAGEM
# -----------------------------------------------------------------
# Nota didática: Processos de outras sessões desconectadas (ex: Session 4 do usuário ivovi)
# podem não responder a Stop-Process individual. O taskkill /F /T /IM disparado com token
# de Administrador garante o encerramento em todas as sessões ativas e desconectadas.
foreach ($cExe in $candidateExes) {
    if ($protectedExes -contains $cExe) { continue }
    # Filtro estrito: somente executáveis com identificadores específicos de aplicativo
    if ($cExe.Length -ge 4 -and $cExe -notmatch '^(setup|unins|install|update|launcher|service)\.exe$') {
        try {
            & taskkill /f /t /im $cExe 2>$null | Out-Null
        } catch {}
    }
}

# -----------------------------------------------------------------
# 5. RETORNO DO RESULTADO ESTRUTURADO
# -----------------------------------------------------------------
[PSCustomObject]@{
    Success = $true
    KilledCount = $killed.Count
    KilledProcesses = $killed
} | ConvertTo-Json -Depth 3 -Compress
