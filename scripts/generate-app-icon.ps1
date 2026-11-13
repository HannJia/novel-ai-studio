param(
  [string]$OutputPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) 'build\icon.ico')
)

Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param(
    [System.Drawing.RectangleF]$Bounds,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($Bounds.X, $Bounds.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Bounds.Right - $diameter, $Bounds.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Bounds.Right - $diameter, $Bounds.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Bounds.X, $Bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconPng {
  param([int]$Size)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 64.0
  $bounds = [System.Drawing.RectangleF]::new(0, 0, $Size, $Size)
  $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#8f1d22'))
  $rounded = New-RoundedPath -Bounds $bounds -Radius (14 * $scale)
  $graphics.FillPath($background, $rounded)

  $swoosh = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $swoosh.AddBezier(
    [System.Drawing.PointF]::new(12 * $scale, 52 * $scale),
    [System.Drawing.PointF]::new(20 * $scale, 47 * $scale),
    [System.Drawing.PointF]::new(29 * $scale, 46 * $scale),
    [System.Drawing.PointF]::new(38 * $scale, 49 * $scale)
  )
  $swoosh.AddBezier(
    [System.Drawing.PointF]::new(38 * $scale, 49 * $scale),
    [System.Drawing.PointF]::new(44 * $scale, 51 * $scale),
    [System.Drawing.PointF]::new(48 * $scale, 50 * $scale),
    [System.Drawing.PointF]::new(52 * $scale, 47 * $scale)
  )
  $swoosh.AddBezier(
    [System.Drawing.PointF]::new(52 * $scale, 47 * $scale),
    [System.Drawing.PointF]::new(50 * $scale, 55 * $scale),
    [System.Drawing.PointF]::new(43 * $scale, 61 * $scale),
    [System.Drawing.PointF]::new(35 * $scale, 59 * $scale)
  )
  $swoosh.AddBezier(
    [System.Drawing.PointF]::new(35 * $scale, 59 * $scale),
    [System.Drawing.PointF]::new(26 * $scale, 58 * $scale),
    [System.Drawing.PointF]::new(18 * $scale, 59 * $scale),
    [System.Drawing.PointF]::new(12 * $scale, 61 * $scale)
  )
  $swoosh.CloseFigure()
  $swooshColor = [System.Drawing.Color]::FromArgb(122, [System.Drawing.ColorTranslator]::FromHtml('#31181b'))
  $swooshBrush = [System.Drawing.SolidBrush]::new($swooshColor)
  $graphics.FillPath($swooshBrush, $swoosh)

  $font = [System.Drawing.Font]::new('Microsoft YaHei', 34 * $scale, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#fff8ed'))
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textBounds = [System.Drawing.RectangleF]::new(0, 7 * $scale, $Size, 51 * $scale)
  $graphics.DrawString(([string][char]0x58a8), $font, $textBrush, $textBounds, $format)

  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()

  $format.Dispose()
  $textBrush.Dispose()
  $font.Dispose()
  $swooshBrush.Dispose()
  $swoosh.Dispose()
  $background.Dispose()
  $rounded.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  $stream.Dispose()
  return $bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
  [pscustomobject]@{ Size = $size; Bytes = (New-IconPng -Size $size) }
}

$header = [byte[]](0, 0, 1, 0, [byte]$images.Count, 0)
$directory = [System.IO.MemoryStream]::new()
$payload = [System.IO.MemoryStream]::new()
$offset = $header.Length + ($images.Count * 16)

foreach ($image in $images) {
  $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
  $entry = [byte[]]::new(16)
  $entry[0] = $dimension
  $entry[1] = $dimension
  $entry[4] = 1
  $entry[6] = 32
  [BitConverter]::GetBytes([uint32]$image.Bytes.Length).CopyTo($entry, 8)
  [BitConverter]::GetBytes([uint32]$offset).CopyTo($entry, 12)
  $directory.Write($entry, 0, $entry.Length)
  $payload.Write($image.Bytes, 0, $image.Bytes.Length)
  $offset += $image.Bytes.Length
}

$directoryBytes = $directory.ToArray()
$payloadBytes = $payload.ToArray()
$directory.Dispose()
$payload.Dispose()

$parent = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null
[System.IO.File]::WriteAllBytes($OutputPath, $header + $directoryBytes + $payloadBytes)
Write-Output (ConvertTo-Json @{ outputPath = $OutputPath; sizes = $sizes; bytes = (Get-Item $OutputPath).Length } -Compress)
