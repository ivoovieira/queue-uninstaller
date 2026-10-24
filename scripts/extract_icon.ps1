param([string]$FilePath)
Add-Type -AssemblyName System.Drawing
if (Test-Path $FilePath) {
    try {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($FilePath)
        if ($icon) {
            $bmp = $icon.ToBitmap()
            $ms = New-Object System.IO.MemoryStream
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $bytes = $ms.ToArray()
            $base64 = [Convert]::ToBase64String($bytes)
            Write-Output "data:image/png;base64,$base64"
        }
    } catch {
        Write-Output ""
    }
}
