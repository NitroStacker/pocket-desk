[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateRange(64, 512)][int]$MaxSize = 180
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Path).Path)
try {
    $scale = [Math]::Min($MaxSize / $source.Width, $MaxSize / $source.Height)
    $width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($source, 0, 0, $width, $height)
        }
        finally {
            $graphics.Dispose()
        }
        $stream = New-Object System.IO.MemoryStream
        try {
            $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg' | Select-Object -First 1
            $quality = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 72L
            $parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
            $parameters.Param[0] = $quality
            try {
                $bitmap.Save($stream, $encoder, $parameters)
                [Convert]::ToBase64String($stream.ToArray())
            }
            finally {
                $quality.Dispose()
                $parameters.Dispose()
            }
        }
        finally {
            $stream.Dispose()
        }
    }
    finally {
        $bitmap.Dispose()
    }
}
finally {
    $source.Dispose()
}
