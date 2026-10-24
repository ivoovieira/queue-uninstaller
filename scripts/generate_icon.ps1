Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$g.Clear([System.Drawing.Color]::Transparent)

# Fundo arredondado com gradiente azul e roxo
$rect = New-Object System.Drawing.Rectangle 16, 16, 224, 224
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 37, 99, 235)), ([System.Drawing.Color]::FromArgb(255, 124, 58, 237)), 45.0
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$diam = 48
$arc = New-Object System.Drawing.Rectangle $rect.X, $rect.Y, $diam, $diam
$path.AddArc($arc, 180, 90)
$arc.X = $rect.Right - $diam
$path.AddArc($arc, 270, 90)
$arc.Y = $rect.Bottom - $diam
$path.AddArc($arc, 0, 90)
$arc.X = $rect.Left
$path.AddArc($arc, 90, 90)
$path.CloseFigure()
$g.FillPath($brush, $path)

# Borda elegante
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 255, 255, 255)), 6
$g.DrawPath($pen, $path)

# Letra 'Q' central
$font = New-Object System.Drawing.Font('Segoe UI', [float]100, [System.Drawing.FontStyle]::Bold)
$strFormat = New-Object System.Drawing.StringFormat
$strFormat.Alignment = [System.Drawing.StringAlignment]::Center
$strFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$g.DrawString('Q', $font, $textBrush, (New-Object System.Drawing.RectangleF 0, 10, 256, 256), $strFormat)

$bmp.Save('icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = New-Object System.IO.FileStream 'icon.ico', ([System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
$g.Dispose()

Write-Output 'Icone icon.ico gerado com sucesso!'
