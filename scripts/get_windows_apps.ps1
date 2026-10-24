[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$apps = Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | Where-Object {
    (-not $_.IsFramework) -and (-not $_.NonRemovable) -and ($_.InstallLocation -and (Test-Path $_.InstallLocation))
}

$list = foreach ($a in $apps) {
    $cleanName = if ($a.Name) { ($a.Name -split '\.')[-1] } else { $a.Name }
    [PSCustomObject]@{
        Id = [string]$a.PackageFullName
        DisplayName = [string]$a.Name
        DisplayVersion = [string]$a.Version
        Publisher = [string]($a.Publisher -replace 'CN=|,.*', '')
        InstallDate = ""
        EstimatedSizeKb = 0
        InstallLocation = [string]$a.InstallLocation
        UninstallString = "powershell -Command Remove-AppxPackage -Package $($a.PackageFullName) -AllUsers"
        QuietUninstallString = "powershell -Command Remove-AppxPackage -Package $($a.PackageFullName) -AllUsers"
        Architecture = if ($a.Architecture -eq 9) { "64-bit" } else { "32-bit" }
        WebSite = "https://apps.microsoft.com"
        Comments = "Aplicativo da Microsoft Store / Windows"
        IconBase64 = ""
        RegistryPath = ""
    }
}

$list | ConvertTo-Json -Depth 3 -Compress
