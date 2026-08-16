param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$TargetProcessId,
    [ValidateRange(0, 9223372036854775807)]
    [int64]$TargetWindowHandle = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PocketDeskVisualNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PrintWindow(IntPtr window, IntPtr target, uint flags);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@
[void][PocketDeskVisualNative]::SetProcessDpiAwarenessContext([IntPtr](-4))

$blockedProcesses = @(
    'Consent', 'CredentialUIBroker', 'LockApp', 'LogonUI',
    'NVIDIA Overlay', 'pcaui', 'PickerHost', 'SecurityHealthHost', 'SecHealthUI',
    'ShellExperienceHost', 'TextInputHost'
)
$process = Get-Process -Id $TargetProcessId -ErrorAction Stop
if ($blockedProcesses -contains $process.ProcessName) {
    throw 'This protected Windows surface cannot be captured.'
}
$window = if ($TargetWindowHandle -gt 0) { [IntPtr]$TargetWindowHandle } else { $process.MainWindowHandle }
$ownerProcessId = [uint32]0
if ($window -ne [IntPtr]::Zero) { [void][PocketDeskVisualNative]::GetWindowThreadProcessId($window, [ref]$ownerProcessId) }
if ($window -eq [IntPtr]::Zero -or [int]$ownerProcessId -ne $process.Id) {
    throw 'The selected application window is no longer available.'
}

$rect = New-Object PocketDeskVisualNative+RECT
if (-not [PocketDeskVisualNative]::GetWindowRect($window, [ref]$rect)) {
    throw 'Could not read the selected window bounds.'
}
$desktop = [System.Windows.Forms.SystemInformation]::VirtualScreen
$left = [Math]::Max($rect.Left, $desktop.Left)
$top = [Math]::Max($rect.Top, $desktop.Top)
$right = [Math]::Min($rect.Right, $desktop.Right)
$bottom = [Math]::Min($rect.Bottom, $desktop.Bottom)
$sourceWidth = [Math]::Max(1, $right - $left)
$sourceHeight = [Math]::Max(1, $bottom - $top)

$sourceBitmap = New-Object System.Drawing.Bitmap $sourceWidth, $sourceHeight, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$sourceGraphics = [System.Drawing.Graphics]::FromImage($sourceBitmap)
try {
    $sourceGraphics.Clear([System.Drawing.Color]::FromArgb(20, 24, 32))
    $rendered = $false
    if ($left -eq $rect.Left -and $top -eq $rect.Top -and $right -eq $rect.Right -and $bottom -eq $rect.Bottom) {
        $dc = $sourceGraphics.GetHdc()
        try { $rendered = [PocketDeskVisualNative]::PrintWindow($window, $dc, 2) }
        finally { $sourceGraphics.ReleaseHdc($dc) }
    }
    if (-not $rendered) {
        $sourceGraphics.CopyFromScreen($left, $top, 0, 0, $sourceBitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
    }
}
finally { $sourceGraphics.Dispose() }

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' } |
    Select-Object -First 1
$encoded = $null
$encodedWidth = 0
$encodedHeight = 0
$attempts = @(
    @{ width = 900; quality = 62 },
    @{ width = 760; quality = 52 },
    @{ width = 640; quality = 42 },
    @{ width = 520; quality = 34 },
    @{ width = 420; quality = 28 }
)

try {
    foreach ($attempt in $attempts) {
        $encodedWidth = [Math]::Min([int]$attempt.width, $sourceWidth)
        $encodedHeight = [Math]::Max(1, [int][Math]::Round($sourceHeight * ($encodedWidth / [double]$sourceWidth)))
        $scaled = New-Object System.Drawing.Bitmap $encodedWidth, $encodedHeight, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($scaled)
            try {
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.DrawImage($sourceBitmap, 0, 0, $encodedWidth, $encodedHeight)
            }
            finally { $graphics.Dispose() }

            $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
            try {
                $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
                    [System.Drawing.Imaging.Encoder]::Quality,
                    [long]$attempt.quality
                )
                $stream = New-Object System.IO.MemoryStream
                try {
                    $scaled.Save($stream, $jpegCodec, $parameters)
                    $encoded = $stream.ToArray()
                }
                finally { $stream.Dispose() }
            }
            finally { $parameters.Dispose() }
        }
        finally { $scaled.Dispose() }

        if ($encoded.Length -le 76000) { break }
    }
}
finally { $sourceBitmap.Dispose() }

if ($null -eq $encoded -or $encoded.Length -gt 80000) {
    throw 'The selected application preview could not fit in the secure relay envelope.'
}

[PSCustomObject]@{
    processId = $process.Id
    windowHandle = [int64]$window.ToInt64()
    width = $encodedWidth
    height = $encodedHeight
    capturedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    dataUri = 'data:image/jpeg;base64,' + [Convert]::ToBase64String($encoded)
} | ConvertTo-Json -Compress
