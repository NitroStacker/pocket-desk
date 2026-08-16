param(
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][ValidateRange(20, 90)][int]$Quality,
    [Parameter(Mandatory = $true)][ValidateRange(1, 12)][int]$Fps
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PocketDeskCaptureNative {
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@
[void][PocketDeskCaptureNative]::SetProcessDpiAwarenessContext([IntPtr](-4))

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$streamWidth = [Math]::Min($Width, $bounds.Width)
$streamHeight = [Math]::Max(1, [int][Math]::Round($bounds.Height * ($streamWidth / [double]$bounds.Width)))
$meta = @{
    sourceWidth = $bounds.Width
    sourceHeight = $bounds.Height
    streamWidth = $streamWidth
    streamHeight = $streamHeight
    left = $bounds.Left
    top = $bounds.Top
} | ConvertTo-Json -Compress
[Console]::Error.WriteLine("POCKETDESK_META $meta")

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' } |
    Select-Object -First 1
$encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality,
    [long]$Quality
)
$output = [Console]::OpenStandardOutput()
$writer = New-Object System.IO.BinaryWriter($output)
$frameBudgetMs = [Math]::Max(1, [int][Math]::Floor(1000 / $Fps))

try {
    while ($true) {
        $startedAt = [Environment]::TickCount64
        $sourceBitmap = $null
        $sourceGraphics = $null
        $streamBitmap = $null
        $streamGraphics = $null
        $memory = $null

        try {
            $sourceBitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
            $sourceGraphics = [System.Drawing.Graphics]::FromImage($sourceBitmap)
            $sourceGraphics.CopyFromScreen(
                $bounds.Left,
                $bounds.Top,
                0,
                0,
                $bounds.Size,
                [System.Drawing.CopyPixelOperation]::SourceCopy
            )

            $streamBitmap = New-Object System.Drawing.Bitmap($streamWidth, $streamHeight)
            $streamGraphics = [System.Drawing.Graphics]::FromImage($streamBitmap)
            $streamGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
            $streamGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
            $streamGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighSpeed
            $streamGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighSpeed
            $streamGraphics.DrawImage($sourceBitmap, 0, 0, $streamWidth, $streamHeight)

            $memory = New-Object System.IO.MemoryStream
            $streamBitmap.Save($memory, $jpegCodec, $encoderParameters)
            $bytes = $memory.ToArray()
            $writer.Write([int]$bytes.Length)
            $writer.Write($bytes)
            $writer.Flush()
        }
        finally {
            if ($null -ne $memory) { $memory.Dispose() }
            if ($null -ne $streamGraphics) { $streamGraphics.Dispose() }
            if ($null -ne $streamBitmap) { $streamBitmap.Dispose() }
            if ($null -ne $sourceGraphics) { $sourceGraphics.Dispose() }
            if ($null -ne $sourceBitmap) { $sourceBitmap.Dispose() }
        }

        $elapsed = [Environment]::TickCount64 - $startedAt
        $remaining = $frameBudgetMs - $elapsed
        if ($remaining -gt 0) { Start-Sleep -Milliseconds $remaining }
    }
}
finally {
    $encoderParameters.Dispose()
    $writer.Dispose()
}
