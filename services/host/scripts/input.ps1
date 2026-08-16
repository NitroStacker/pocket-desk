$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PocketDeskNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@
[void][PocketDeskNative]::SetProcessDpiAwarenessContext([IntPtr](-4))

$MouseLeftDown = 0x0002
$MouseLeftUp = 0x0004
$MouseRightDown = 0x0008
$MouseRightUp = 0x0010
$MouseWheel = 0x0800
$KeyUp = 0x0002

$keyCodes = @{
    Backspace = 0x08; Tab = 0x09; Enter = 0x0D; Shift = 0x10; Ctrl = 0x11; Alt = 0x12
    Escape = 0x1B; Space = 0x20; PageUp = 0x21; PageDown = 0x22; End = 0x23; Home = 0x24
    Left = 0x25; Up = 0x26; Right = 0x27; Down = 0x28; Delete = 0x2E; Win = 0x5B
    F4 = 0x73
}

function Get-KeyCode([string]$key) {
    if ($keyCodes.ContainsKey($key)) { return [byte]$keyCodes[$key] }
    if ($key.Length -eq 1) { return [byte][char]$key.ToUpperInvariant() }
    throw "Unsupported key: $key"
}

function Set-NormalizedCursor([double]$x, [double]$y) {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $pixelX = $bounds.Left + [int][Math]::Round($x * ($bounds.Width - 1))
    $pixelY = $bounds.Top + [int][Math]::Round($y * ($bounds.Height - 1))
    [void][PocketDeskNative]::SetCursorPos($pixelX, $pixelY)
}

function Send-KeyDown([byte]$code) {
    [PocketDeskNative]::keybd_event($code, 0, 0, [UIntPtr]::Zero)
}

function Send-KeyUp([byte]$code) {
    [PocketDeskNative]::keybd_event($code, 0, $KeyUp, [UIntPtr]::Zero)
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    try {
        $command = $line | ConvertFrom-Json
        switch ($command.kind) {
            'pointerDown' {
                Set-NormalizedCursor $command.x $command.y
                [PocketDeskNative]::mouse_event($MouseLeftDown, 0, 0, 0, [UIntPtr]::Zero)
            }
            'pointerMove' { Set-NormalizedCursor $command.x $command.y }
            'pointerUp' {
                Set-NormalizedCursor $command.x $command.y
                [PocketDeskNative]::mouse_event($MouseLeftUp, 0, 0, 0, [UIntPtr]::Zero)
            }
            'tap' {
                Set-NormalizedCursor $command.x $command.y
                [PocketDeskNative]::mouse_event($MouseLeftDown, 0, 0, 0, [UIntPtr]::Zero)
                [PocketDeskNative]::mouse_event($MouseLeftUp, 0, 0, 0, [UIntPtr]::Zero)
            }
            'doubleClick' {
                Set-NormalizedCursor $command.x $command.y
                1..2 | ForEach-Object {
                    [PocketDeskNative]::mouse_event($MouseLeftDown, 0, 0, 0, [UIntPtr]::Zero)
                    [PocketDeskNative]::mouse_event($MouseLeftUp, 0, 0, 0, [UIntPtr]::Zero)
                    Start-Sleep -Milliseconds 70
                }
            }
            'moveRelative' {
                $point = New-Object PocketDeskNative+POINT
                if ([PocketDeskNative]::GetCursorPos([ref]$point)) {
                    [void][PocketDeskNative]::SetCursorPos(
                        $point.X + [int][Math]::Round($command.dx * 1.6),
                        $point.Y + [int][Math]::Round($command.dy * 1.6)
                    )
                }
            }
            'leftClick' {
                [PocketDeskNative]::mouse_event($MouseLeftDown, 0, 0, 0, [UIntPtr]::Zero)
                [PocketDeskNative]::mouse_event($MouseLeftUp, 0, 0, 0, [UIntPtr]::Zero)
            }
            'rightClick' {
                [PocketDeskNative]::mouse_event($MouseRightDown, 0, 0, 0, [UIntPtr]::Zero)
                [PocketDeskNative]::mouse_event($MouseRightUp, 0, 0, 0, [UIntPtr]::Zero)
            }
            'scroll' {
                [PocketDeskNative]::mouse_event($MouseWheel, 0, 0, [int]$command.delta, [UIntPtr]::Zero)
            }
            'key' {
                $code = Get-KeyCode $command.key
                Send-KeyDown $code
                Send-KeyUp $code
            }
            'shortcut' {
                $codes = @($command.keys | ForEach-Object { Get-KeyCode $_ })
                foreach ($code in $codes) { Send-KeyDown $code }
                [Array]::Reverse($codes)
                foreach ($code in $codes) { Send-KeyUp $code }
            }
            'text' {
                if (-not [string]::IsNullOrEmpty($command.text)) {
                    [System.Windows.Forms.Clipboard]::SetText([string]$command.text)
                    Send-KeyDown 0x11
                    Send-KeyDown 0x56
                    Send-KeyUp 0x56
                    Send-KeyUp 0x11
                }
            }
            'replaceText' {
                Set-NormalizedCursor $command.x $command.y
                [PocketDeskNative]::mouse_event($MouseLeftDown, 0, 0, 0, [UIntPtr]::Zero)
                [PocketDeskNative]::mouse_event($MouseLeftUp, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Milliseconds 80
                Send-KeyDown 0x11
                Send-KeyDown 0x41
                Send-KeyUp 0x41
                Send-KeyUp 0x11
                if (-not [string]::IsNullOrEmpty($command.text)) {
                    [System.Windows.Forms.Clipboard]::SetText([string]$command.text)
                    Send-KeyDown 0x11
                    Send-KeyDown 0x56
                    Send-KeyUp 0x56
                    Send-KeyUp 0x11
                }
            }
            'focusWindow' {
                $process = Get-Process -Id ([int]$command.processId) -ErrorAction Stop
                $window = $process.MainWindowHandle
                if ($null -ne $command.windowHandle -and [int64]$command.windowHandle -gt 0) {
                    $candidate = [IntPtr]([int64]$command.windowHandle)
                    $ownerProcessId = [uint32]0
                    [void][PocketDeskNative]::GetWindowThreadProcessId($candidate, [ref]$ownerProcessId)
                    if ([int]$ownerProcessId -ne $process.Id) { throw 'The selected window no longer belongs to that application.' }
                    $window = $candidate
                }
                if ($window -ne [IntPtr]::Zero) {
                    [void][PocketDeskNative]::ShowWindowAsync($window, 9)
                    Send-KeyDown 0x12
                    Send-KeyUp 0x12
                    [void][PocketDeskNative]::SetForegroundWindow($window)
                }
            }
            'closeWindow' {
                $process = Get-Process -Id ([int]$command.processId) -ErrorAction Stop
                $window = [IntPtr]([int64]$command.windowHandle)
                $ownerProcessId = [uint32]0
                [void][PocketDeskNative]::GetWindowThreadProcessId($window, [ref]$ownerProcessId)
                if ([int]$ownerProcessId -ne $process.Id) { throw 'The selected window no longer belongs to that application.' }
                if (-not [PocketDeskNative]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
                    throw 'Windows could not close the selected window.'
                }
            }
        }
    }
    catch {
        [Console]::Error.WriteLine($_.Exception.Message)
    }
}
