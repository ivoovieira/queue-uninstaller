Add-Type -AssemblyName System.Drawing

function Create-AppIcon {
    $size = 512
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $g.Clear([System.Drawing.Color]::Transparent)

    # 1. Base Squircle (Formato moderno Windows 11 com cantos suaves)
    $pad = 32
    $rectW = $size - (2 * $pad)
    $rect = New-Object System.Drawing.Rectangle $pad, $pad, $rectW, $rectW
    $radius = 110
    $diam = $radius * 2

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($rect.X, $rect.Y, $diam, $diam, 180, 90)
    $path.AddArc($rect.Right - $diam, $rect.Y, $diam, $diam, 270, 90)
    $path.AddArc($rect.Right - $diam, $rect.Bottom - $diam, $diam, $diam, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $diam, $diam, $diam, 90, 90)
    $path.CloseFigure()

    # Preenchimento de Fundo: Gradiente profundo e elegante Slate / Deep Navy
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.PointF 0, 0),
        (New-Object System.Drawing.PointF $size, $size),
        ([System.Drawing.Color]::FromArgb(255, 12, 19, 36)),
        ([System.Drawing.Color]::FromArgb(255, 23, 37, 68))
    )
    $g.FillPath($bgBrush, $path)

    # Brilho de Borda Superior (Acrílico sutil Fluent)
    $borderPen = New-Object System.Drawing.Pen (
        (New-Object System.Drawing.Drawing2D.LinearGradientBrush (
            (New-Object System.Drawing.PointF 0, $pad),
            (New-Object System.Drawing.PointF 0, ($size - $pad)),
            ([System.Drawing.Color]::FromArgb(180, 56, 189, 248)),
            ([System.Drawing.Color]::FromArgb(40, 37, 99, 235))
        )),
        7
    )
    $g.DrawPath($borderPen, $path)

    # 2. Anel Exterior do 'Q' estilizado
    $ringPad = 115
    $ringSize = $size - (2 * $ringPad)
    $ringRect = New-Object System.Drawing.Rectangle $ringPad, ($ringPad - 15), $ringSize, $ringSize
    
    $ringPen = New-Object System.Drawing.Pen (
        (New-Object System.Drawing.Drawing2D.LinearGradientBrush (
            (New-Object System.Drawing.PointF $ringPad, $ringPad),
            (New-Object System.Drawing.PointF ($size - $ringPad), ($size - $ringPad)),
            ([System.Drawing.Color]::FromArgb(255, 6, 182, 212)),  # Cyan elétrico
            ([System.Drawing.Color]::FromArgb(255, 59, 130, 246))  # Azul royal vibrante
        )),
        44
    )
    $ringPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $ringPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    # Desenha o anel aberto para a cauda do Q
    $g.DrawArc($ringPen, $ringRect, -30, 300)

    # 3. Barras de Fila (Queue bars) no centro do anel
    $barBrush1 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 255, 255, 255))
    $barBrush2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 56, 189, 248))
    $barBrush3 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 96, 165, 250))

    function Draw-Pill($gfx, $brush, $x, $y, $w, $h) {
        $r = $h / 2
        $p = New-Object System.Drawing.Drawing2D.GraphicsPath
        $p.AddArc($x, $y, $h, $h, 90, 180)
        $p.AddArc(($x + $w - $h), $y, $h, $h, 270, 180)
        $p.CloseFigure()
        $gfx.FillPath($brush, $p)
        $p.Dispose()
    }

    $cx = 256
    $cy = 241
    Draw-Pill $g $barBrush1 ($cx - 55) ($cy - 52) 110 20
    Draw-Pill $g $barBrush2 ($cx - 75) ($cy - 10) 150 22
    Draw-Pill $g $barBrush3 ($cx - 50) ($cy + 34) 100 20

    # 4. Cauda dinâmica do 'Q' (Estilizada em flecha / impulso de fila)
    $tailPen = New-Object System.Drawing.Pen (
        (New-Object System.Drawing.Drawing2D.LinearGradientBrush (
            (New-Object System.Drawing.PointF 300, 300),
            (New-Object System.Drawing.PointF 430, 430),
            ([System.Drawing.Color]::FromArgb(255, 59, 130, 246)),
            ([System.Drawing.Color]::FromArgb(255, 14, 165, 233))
        )),
        44
    )
    $tailPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $tailPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($tailPen, 310, 310, 395, 395)

    # Ponto de brilho / indicador no topo do anel
    $glowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $g.FillEllipse($glowBrush, 246, ($ringPad - 25), 20, 20)

    # Salva versão em PNG 256x256 e 512x512
    $png256 = New-Object System.Drawing.Bitmap 256, 256
    $g256 = [System.Drawing.Graphics]::FromImage($png256)
    $g256.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g256.DrawImage($bmp, 0, 0, 256, 256)
    $png256.Save('icon.png', [System.Drawing.Imaging.ImageFormat]::Png)

    # Criação de ICO real multi-resolução para máxima nitidez no Windows (256, 128, 64, 48, 32, 16)
    $sizes = @(256, 128, 64, 48, 32, 16)
    $images = @()
    foreach ($s in $sizes) {
        $sub = New-Object System.Drawing.Bitmap $s, $s
        $sg = [System.Drawing.Graphics]::FromImage($sub)
        $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $sg.DrawImage($bmp, 0, 0, $s, $s)
        $sg.Dispose()
        $images += $sub
    }

    # Salva icon.ico
    $hIcon = $png256.GetHicon()
    $iconObj = [System.Drawing.Icon]::FromHandle($hIcon)
    $fs = New-Object System.IO.FileStream 'icon.ico', ([System.IO.FileMode]::Create)
    $iconObj.Save($fs)
    $fs.Close()

    $iconObj.Dispose()
    $png256.Dispose()
    $g256.Dispose()
    $bmp.Dispose()
    $g.Dispose()

    Write-Output "Novo ícone de alta fidelidade icon.png e icon.ico gerados com sucesso!"
}

Create-AppIcon
