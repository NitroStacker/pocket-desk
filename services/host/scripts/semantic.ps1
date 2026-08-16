param(
    [ValidateRange(0, 2147483647)]
    [int]$TargetProcessId = 0,
    [ValidateRange(0, 9223372036854775807)]
    [int64]$TargetWindowHandle = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PocketDeskSemanticNative {
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int maximum);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@
[void][PocketDeskSemanticNative]::SetProcessDpiAwarenessContext([IntPtr](-4))

function Read-PatternValue($Element, $PatternType, [scriptblock]$Reader) {
    try {
        $pattern = $null
        if ($Element.TryGetCurrentPattern($PatternType, [ref]$pattern)) {
            return & $Reader $pattern
        }
    }
    catch { }
    return $null
}

function Has-Pattern($Element, $PatternType) {
    try {
        $pattern = $null
        return $Element.TryGetCurrentPattern($PatternType, [ref]$pattern)
    }
    catch { return $false }
}

function Clean-UiText([string]$Value, [int]$MaximumLength) {
    if ([string]::IsNullOrEmpty($Value)) { return '' }
    $clean = [Text.RegularExpressions.Regex]::Replace($Value, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '')
    if ($clean.Length -gt $MaximumLength) { return $clean.Substring(0, $MaximumLength) }
    return $clean
}

function Await-WinRt($Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    [void]$task.Wait(-1)
    return $task.Result
}

function Read-OcrLines($WindowRect) {
    $output = New-Object System.Collections.Generic.List[object]
    $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ('pocketdesk-ocr-' + [guid]::NewGuid().ToString('N') + '.png')
    $sourceBitmap = $null
    $ocrBitmap = $null
    try {
        $width = [Math]::Max(1, $WindowRect.Right - $WindowRect.Left)
        $height = [Math]::Max(1, $WindowRect.Bottom - $WindowRect.Top)
        $sourceBitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($sourceBitmap)
        try {
            $graphics.CopyFromScreen($WindowRect.Left, $WindowRect.Top, 0, 0, $sourceBitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
        }
        finally { $graphics.Dispose() }

        [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
        [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
        [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
        [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
        [void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

        $maxDimension = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
        $scale = [Math]::Min(1.0, $maxDimension / [double][Math]::Max($width, $height))
        if ($scale -lt 1.0) {
            $scaledWidth = [Math]::Max(1, [int]($width * $scale))
            $scaledHeight = [Math]::Max(1, [int]($height * $scale))
            $ocrBitmap = New-Object System.Drawing.Bitmap $scaledWidth, $scaledHeight, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $scaledGraphics = [System.Drawing.Graphics]::FromImage($ocrBitmap)
            try {
                $scaledGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $scaledGraphics.DrawImage($sourceBitmap, 0, 0, $scaledWidth, $scaledHeight)
            }
            finally { $scaledGraphics.Dispose() }
        }
        else { $ocrBitmap = $sourceBitmap }

        $ocrBitmap.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tempPath)) ([Windows.Storage.StorageFile])
        $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        try {
            $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $softwareBitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            try {
                $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
                if ($null -eq $engine) { return $output.ToArray() }
                $result = Await-WinRt ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
                foreach ($line in @($result.Lines)) {
                    $text = (Clean-UiText ([string]$line.Text) 500).Trim()
                    $words = @($line.Words)
                    if ([string]::IsNullOrWhiteSpace($text) -or $words.Count -eq 0) { continue }
                    if ($text.Length -gt 500) { $text = $text.Substring(0, 500) }

                    $left = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
                    $top = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
                    $right = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
                    $bottom = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
                    $output.Add([PSCustomObject]@{
                        text = $text
                        rect = [PSCustomObject]@{
                            left = $WindowRect.Left + ($left / $scale)
                            top = $WindowRect.Top + ($top / $scale)
                            width = ($right - $left) / $scale
                            height = ($bottom - $top) / $scale
                        }
                    })
                    if ($output.Count -ge 160) { break }
                }
            }
            finally { if ($null -ne $softwareBitmap) { $softwareBitmap.Dispose() } }
        }
        finally { if ($null -ne $stream) { $stream.Dispose() } }
    }
    catch { $script:ocrError = $_.Exception.Message }
    finally {
        if ($null -ne $ocrBitmap -and $ocrBitmap -ne $sourceBitmap) { $ocrBitmap.Dispose() }
        if ($null -ne $sourceBitmap) { $sourceBitmap.Dispose() }
        Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    }
    return $output.ToArray()
}

$desktopBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$blockedProcesses = @(
    'Consent', 'CredentialUIBroker', 'LockApp', 'LogonUI',
    'NVIDIA Overlay', 'pcaui', 'PickerHost', 'SecurityHealthHost', 'SecHealthUI',
    'ShellExperienceHost', 'TextInputHost'
)
$foreground = [PocketDeskSemanticNative]::GetForegroundWindow()
$foregroundHandle = $foreground.ToInt64()
$enumeratedWindows = New-Object System.Collections.Generic.List[object]
$enumCallback = [PocketDeskSemanticNative+EnumWindowsProc]{
    param([IntPtr]$window, [IntPtr]$parameter)
    try {
        if (-not [PocketDeskSemanticNative]::IsWindowVisible($window)) { return $true }
        $cloaked = 0
        if ([PocketDeskSemanticNative]::DwmGetWindowAttribute($window, 14, [ref]$cloaked, 4) -eq 0 -and $cloaked -ne 0) { return $true }
        $titleLength = [PocketDeskSemanticNative]::GetWindowTextLength($window)
        if ($titleLength -le 0) { return $true }
        $builder = New-Object System.Text.StringBuilder ($titleLength + 1)
        if ([PocketDeskSemanticNative]::GetWindowText($window, $builder, $builder.Capacity) -le 0) { return $true }
        $title = (Clean-UiText $builder.ToString() 300).Trim()
        if ([string]::IsNullOrWhiteSpace($title)) { return $true }

        $processId = [uint32]0
        [void][PocketDeskSemanticNative]::GetWindowThreadProcessId($window, [ref]$processId)
        if ($processId -le 0) { return $true }
        $process = Get-Process -Id ([int]$processId) -ErrorAction Stop
        if ($blockedProcesses -contains $process.ProcessName) { return $true }
        if ($process.ProcessName -eq 'explorer' -and $title -eq 'Program Manager') { return $true }

        $rect = New-Object PocketDeskSemanticNative+RECT
        if (-not [PocketDeskSemanticNative]::GetWindowRect($window, [ref]$rect)) { return $true }
        if (-not [PocketDeskSemanticNative]::IsIconic($window) -and (($rect.Right - $rect.Left) -lt 80 -or ($rect.Bottom - $rect.Top) -lt 40)) { return $true }

        $handle = $window.ToInt64()
        $enumeratedWindows.Add([PSCustomObject]@{
            processId = [int]$processId
            windowHandle = [int64]$handle
            title = $title
            process = $process.ProcessName
            active = ($handle -eq $foregroundHandle)
        })
    }
    catch { }
    return $true
}
[void][PocketDeskSemanticNative]::EnumWindows($enumCallback, [IntPtr]::Zero)

$windows = @($enumeratedWindows | Sort-Object @{ Expression = 'active'; Descending = $true }, title)
$selectedWindow = $null
if ($TargetWindowHandle -gt 0) {
    $selectedWindow = $windows | Where-Object {
        $_.windowHandle -eq $TargetWindowHandle -and ($TargetProcessId -le 0 -or $_.processId -eq $TargetProcessId)
    } | Select-Object -First 1
}
if ($null -eq $selectedWindow -and $TargetProcessId -gt 0) {
    $selectedWindow = $windows | Where-Object { $_.processId -eq $TargetProcessId } |
        Sort-Object @{ Expression = 'active'; Descending = $true } | Select-Object -First 1
}
if ($null -eq $selectedWindow -and $TargetProcessId -le 0 -and $TargetWindowHandle -le 0) {
    $selectedWindow = $windows | Where-Object { $_.windowHandle -eq $foregroundHandle } | Select-Object -First 1
}

$targetWindow = if ($null -ne $selectedWindow) { [IntPtr]([int64]$selectedWindow.windowHandle) } else { [IntPtr]::Zero }
$activeProcessId = if ($null -ne $selectedWindow) { [uint32]$selectedWindow.processId } else { [uint32]0 }
$activeWindowHandle = if ($null -ne $selectedWindow) { [int64]$selectedWindow.windowHandle } else { [int64]0 }
$targetProcessName = if ($null -ne $selectedWindow) { [string]$selectedWindow.process } else { '' }
$blockedTarget = $null -eq $selectedWindow
$windowRect = New-Object PocketDeskSemanticNative+RECT
if ($targetWindow -eq [IntPtr]::Zero -or -not [PocketDeskSemanticNative]::GetWindowRect($targetWindow, [ref]$windowRect)) {
    $windowRect.Left = $desktopBounds.Left
    $windowRect.Top = $desktopBounds.Top
    $windowRect.Right = $desktopBounds.Right
    $windowRect.Bottom = $desktopBounds.Bottom
}
$windowRect.Left = [Math]::Max($windowRect.Left, $desktopBounds.Left)
$windowRect.Top = [Math]::Max($windowRect.Top, $desktopBounds.Top)
$windowRect.Right = [Math]::Min($windowRect.Right, $desktopBounds.Right)
$windowRect.Bottom = [Math]::Min($windowRect.Bottom, $desktopBounds.Bottom)

$windows = @($windows | ForEach-Object {
    $_.active = ($_.windowHandle -eq $activeWindowHandle)
    $_
})

$controls = New-Object System.Collections.Generic.List[object]
$scanErrors = New-Object System.Collections.Generic.List[string]
$script:ocrError = ''
$activeTitle = ($windows | Where-Object { $_.windowHandle -eq $activeWindowHandle } | Select-Object -First 1).title
if ($blockedTarget) {
    $activeProcessId = [uint32]0
    $activeTitle = 'Choose an app'
}
elseif ([string]::IsNullOrWhiteSpace($activeTitle)) { $activeTitle = 'Desktop' }
$accessibleText = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
$readableCharacters = 0

if (-not $blockedTarget) { try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($targetWindow)
    if ($null -ne $root) {
        $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
        $queue = New-Object 'System.Collections.Generic.Queue[object]'
        $queue.Enqueue([PSCustomObject]@{ element = $root; depth = 0; section = ''; parentRuntimeId = '' })
        $visited = 0
        $interactiveKinds = @('Button', 'MenuItem', 'TabItem', 'CheckBox', 'RadioButton', 'Hyperlink', 'ComboBox', 'TreeItem', 'ListItem', 'DataItem', 'Slider', 'Spinner', 'ScrollBar', 'SplitButton')
        $fieldKinds = @('Edit', 'Document', 'ComboBox')
        $contentKinds = @('ListItem', 'DataItem', 'Text', 'Document', 'HeaderItem', 'Image')
        $sectionKinds = @('Group', 'Pane', 'ToolBar', 'MenuBar', 'Menu', 'StatusBar', 'Header', 'Window')

        while ($queue.Count -gt 0 -and $visited -lt 6000 -and $controls.Count -lt 320) {
            $entry = $queue.Dequeue()
            $element = $entry.element
            $visited += 1
            $childSection = [string]$entry.section

            try {
                $current = $element.Current
                $kind = $current.ControlType.ProgrammaticName.Replace('ControlType.', '')
                $rect = $current.BoundingRectangle
                $name = (Clean-UiText ([string]$current.Name) 500).Trim()
                $automationId = (Clean-UiText ([string]$current.AutomationId) 300).Trim()
                $description = (Clean-UiText ([string]$current.HelpText) 500).Trim()
                $elementRuntimeId = ''
                try { $elementRuntimeId = @($element.GetRuntimeId()) -join '.' } catch { }

                if ($sectionKinds -contains $kind -and -not [string]::IsNullOrWhiteSpace($name)) {
                    $childSection = $name.Substring(0, [Math]::Min(160, $name.Length))
                }

                $hasInvoke = Has-Pattern $element ([System.Windows.Automation.InvokePattern]::Pattern)
                $hasSelection = Has-Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
                $hasToggle = Has-Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern)
                $hasExpand = Has-Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                $hasValue = Has-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
                $interactive = $hasInvoke -or $hasSelection -or $hasToggle -or $hasExpand -or ($interactiveKinds -contains $kind)

                $value = Read-PatternValue $element ([System.Windows.Automation.ValuePattern]::Pattern) {
                    param($pattern)
                    return [string]$pattern.Current.Value
                }
                $editable = Read-PatternValue $element ([System.Windows.Automation.ValuePattern]::Pattern) {
                    param($pattern)
                    return -not [bool]$pattern.Current.IsReadOnly
                }
                if ($null -eq $value) {
                    $value = Read-PatternValue $element ([System.Windows.Automation.RangeValuePattern]::Pattern) {
                        param($pattern)
                        return [string]$pattern.Current.Value
                    }
                }
                $documentText = Read-PatternValue $element ([System.Windows.Automation.TextPattern]::Pattern) {
                    param($pattern)
                    return [string]$pattern.DocumentRange.GetText(12000)
                }
                if ([string]::IsNullOrWhiteSpace([string]$value) -and -not [string]::IsNullOrWhiteSpace([string]$documentText)) {
                    $value = [string]$documentText
                }
                $value = Clean-UiText ([string]$value) 12000

                $selected = Read-PatternValue $element ([System.Windows.Automation.SelectionItemPattern]::Pattern) {
                    param($pattern)
                    return [bool]$pattern.Current.IsSelected
                }
                $toggleState = Read-PatternValue $element ([System.Windows.Automation.TogglePattern]::Pattern) {
                    param($pattern)
                    return [string]$pattern.Current.ToggleState
                }
                $expandState = Read-PatternValue $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern) {
                    param($pattern)
                    return [string]$pattern.Current.ExpandCollapseState
                }

                $visible = -not $current.IsOffscreen -and $rect.Width -gt 1 -and $rect.Height -gt 1
                $include = $visible -and (
                    $interactive -or $hasValue -or ($fieldKinds -contains $kind) -or ($contentKinds -contains $kind)
                )

                if ($include) {
                    if ([string]::IsNullOrWhiteSpace($name)) { $name = $automationId }
                    if ([string]::IsNullOrWhiteSpace($name) -and -not [string]::IsNullOrWhiteSpace([string]$value)) { $name = [string]$value }
                    if ([string]::IsNullOrWhiteSpace($name)) { $name = $kind }
                    $action = if ($editable -eq $true) { 'edit' } elseif ($hasToggle) { 'toggle' } elseif ($hasExpand) { 'expand' } elseif ($hasSelection) { 'select' } elseif ($hasInvoke) { 'invoke' } elseif ($interactive) { 'tap' } else { 'read' }

                    $checked = $null
                    if ($toggleState -eq 'On') { $checked = $true }
                    elseif ($toggleState -eq 'Off') { $checked = $false }
                    $expanded = $null
                    if ($expandState -eq 'Expanded' -or $expandState -eq 'PartiallyExpanded') { $expanded = $true }
                    elseif ($expandState -eq 'Collapsed') { $expanded = $false }

                    $controls.Add([PSCustomObject]@{
                        label = $name
                        kind = $kind
                        automationId = $automationId
                        runtimeId = $elementRuntimeId
                        parentRuntimeId = [string]$entry.parentRuntimeId
                        order = $visited
                        source = 'accessibility'
                        action = $action
                        depth = [int]$entry.depth
                        value = if ($null -eq $value) { '' } else { [string]$value }
                        description = $description
                        section = $childSection
                        enabled = $current.IsEnabled
                        focused = $current.HasKeyboardFocus
                        editable = ($editable -eq $true)
                        interactive = $interactive -or ($editable -eq $true)
                        selected = ($selected -eq $true)
                        checked = $checked
                        expanded = $expanded
                        rect = [PSCustomObject]@{ left = $rect.Left; top = $rect.Top; width = $rect.Width; height = $rect.Height }
                    })
                    if ($name.Length -gt 1) { [void]$accessibleText.Add($name) }
                    if (($contentKinds -contains $kind) -or $kind -eq 'Document') { $readableCharacters += $name.Length + ([string]$value).Length }
                }
            }
            catch {
                if ($scanErrors.Count -lt 10) { $scanErrors.Add($_.Exception.Message) }
            }

            try {
                $child = $walker.GetFirstChild($element)
                while ($null -ne $child) {
                    $queue.Enqueue([PSCustomObject]@{ element = $child; depth = ([int]$entry.depth + 1); section = $childSection; parentRuntimeId = $elementRuntimeId })
                    $child = $walker.GetNextSibling($child)
                }
            }
            catch { }
        }
    }
}
catch {
    if ($scanErrors.Count -lt 10) { $scanErrors.Add($_.Exception.Message) }
} }

$accessibilityCount = $controls.Count
$ocrCount = 0
if (-not $blockedTarget -and ($accessibilityCount -lt 18 -or $readableCharacters -lt 160)) {
    foreach ($line in @(Read-OcrLines $windowRect)) {
        if ($controls.Count -ge 360) { break }
        $text = (Clean-UiText ([string]$line.text) 500).Trim()
        if ($text.Length -lt 2 -or $accessibleText.Contains($text)) { continue }
        [void]$accessibleText.Add($text)
        $controls.Add([PSCustomObject]@{
            label = $text
            kind = 'VisualText'
            automationId = ''
            runtimeId = ''
            parentRuntimeId = ''
            order = 10000 + $ocrCount
            source = 'vision'
            action = 'tap'
            depth = 0
            value = ''
            description = 'Detected on screen'
            section = 'On-screen view'
            enabled = $true
            focused = $false
            editable = $false
            interactive = $true
            selected = $false
            checked = $null
            expanded = $null
            rect = $line.rect
        })
        $ocrCount += 1
    }
}

$adapter = if ($accessibilityCount -gt 0 -and $ocrCount -gt 0) { 'hybrid' } elseif ($accessibilityCount -gt 0) { 'accessibility' } elseif ($ocrCount -gt 0) { 'vision' } else { 'basic' }

[PSCustomObject]@{
    desktop = [PSCustomObject]@{ left = $desktopBounds.Left; top = $desktopBounds.Top; width = $desktopBounds.Width; height = $desktopBounds.Height }
    window = [PSCustomObject]@{ left = $windowRect.Left; top = $windowRect.Top; width = ($windowRect.Right - $windowRect.Left); height = ($windowRect.Bottom - $windowRect.Top) }
    activeProcessId = [int]$activeProcessId
    activeWindowHandle = [int64]$activeWindowHandle
    activeTitle = $activeTitle
    adapter = $adapter
    accessibilityCount = $accessibilityCount
    visionCount = $ocrCount
    windows = $windows
    controls = $controls.ToArray()
} | ConvertTo-Json -Depth 7 -Compress
