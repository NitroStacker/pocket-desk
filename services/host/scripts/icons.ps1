param(
    [Parameter(Mandatory = $true)]
    [string]$ItemsBase64
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PocketDeskIconNative {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SHGetFileInfo(
        string pszPath,
        uint dwFileAttributes,
        ref SHFILEINFO psfi,
        uint cbFileInfo,
        uint uFlags
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DestroyIcon(IntPtr handle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern uint PrivateExtractIcons(
        string fileName,
        int iconIndex,
        int iconWidth,
        int iconHeight,
        [Out] IntPtr[] iconHandles,
        [Out] uint[] iconIds,
        uint iconCount,
        uint flags
    );
}
'@

$outputSize = 128
$sourceIconSize = 256
$shortcutReader = New-Object -ComObject WScript.Shell

function Resolve-IconReference([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    $expandedPath = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    if ([IO.Path]::GetExtension($expandedPath) -ne '.lnk') {
        if (-not (Test-Path -LiteralPath $expandedPath -PathType Leaf)) { return $null }
        return [PSCustomObject]@{ Path = $expandedPath; Index = 0 }
    }

    if (-not (Test-Path -LiteralPath $expandedPath -PathType Leaf)) { return $null }
    try {
        $shortcut = $shortcutReader.CreateShortcut($expandedPath)
        $iconLocation = [string]$shortcut.IconLocation
        if ($iconLocation -match '^(?<path>.*),\s*(?<index>-?\d+)\s*$') {
            $iconPath = [Environment]::ExpandEnvironmentVariables($Matches.path.Trim().Trim('"'))
            if (-not [string]::IsNullOrWhiteSpace($iconPath) -and
                (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
                return [PSCustomObject]@{ Path = $iconPath; Index = [int]$Matches.index }
            }
        }

        $targetPath = [Environment]::ExpandEnvironmentVariables(([string]$shortcut.TargetPath).Trim().Trim('"'))
        if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
            return [PSCustomObject]@{ Path = $targetPath; Index = 0 }
        }
    }
    catch { }
    return $null
}

function Convert-BitmapPng($SourceBitmap) {
    $bitmap = New-Object System.Drawing.Bitmap $outputSize, $outputSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.DrawImage($SourceBitmap, 0, 0, $outputSize, $outputSize)
        }
        finally { $graphics.Dispose() }
        $stream = New-Object System.IO.MemoryStream
        try {
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return 'data:image/png;base64,' + [Convert]::ToBase64String($stream.ToArray())
        }
        finally { $stream.Dispose() }
    }
    finally { $bitmap.Dispose() }
}

function Convert-IconHandlePng([IntPtr]$IconHandle) {
    if ($IconHandle -eq [IntPtr]::Zero) { return $null }
    try {
        $sourceIcon = [System.Drawing.Icon]::FromHandle($IconHandle)
        $sourceBitmap = $sourceIcon.ToBitmap()
        try { return Convert-BitmapPng $sourceBitmap }
        finally { $sourceBitmap.Dispose() }
    }
    finally { [void][PocketDeskIconNative]::DestroyIcon($IconHandle) }
}

function Read-IconPng([string]$Path) {
    $reference = Resolve-IconReference $Path
    if ($null -eq $reference) { return $null }

    $handles = New-Object IntPtr[] 1
    $iconIds = New-Object uint32[] 1
    $count = [PocketDeskIconNative]::PrivateExtractIcons(
        [string]$reference.Path,
        [int]$reference.Index,
        $sourceIconSize,
        $sourceIconSize,
        $handles,
        $iconIds,
        1,
        0
    )
    if ($count -gt 0 -and $handles[0] -ne [IntPtr]::Zero) {
        return Convert-IconHandlePng $handles[0]
    }

    $info = New-Object PocketDeskIconNative+SHFILEINFO
    $flags = [uint32](0x00000100 -bor 0x000000000)
    $result = [PocketDeskIconNative]::SHGetFileInfo(
        [string]$reference.Path,
        0,
        [ref]$info,
        [uint32][Runtime.InteropServices.Marshal]::SizeOf($info),
        $flags
    )
    if ($result -eq [IntPtr]::Zero -or $info.hIcon -eq [IntPtr]::Zero) { return $null }

    return Convert-IconHandlePng $info.hIcon
}

$packageCache = @{}
function Read-PackagedIconPng([string]$AppUserModelId) {
    if ($AppUserModelId -notmatch '^(?<family>[A-Za-z0-9._-]+)!(?<application>[A-Za-z0-9._-]+)$') { return $null }
    $family = $Matches.family
    $applicationId = $Matches.application
    if (-not $packageCache.ContainsKey($family)) {
        $packageCache[$family] = Get-AppxPackage -ErrorAction SilentlyContinue |
            Where-Object { $_.PackageFamilyName -eq $family } |
            Sort-Object Version -Descending | Select-Object -First 1
    }
    $package = $packageCache[$family]
    if ($null -eq $package) { return $null }
    $manifestPath = Join-Path $package.InstallLocation 'AppxManifest.xml'
    if (-not (Test-Path -LiteralPath $manifestPath)) { return $null }

    [xml]$manifest = Get-Content -Raw -LiteralPath $manifestPath
    $application = @($manifest.Package.Applications.Application) |
        Where-Object { [string]$_.Id -eq $applicationId } | Select-Object -First 1
    if ($null -eq $application) { return $null }
    $visual = $application.VisualElements
    if ($null -eq $visual) { return $null }
    $logo = [string]$visual.Square44x44Logo
    if ([string]::IsNullOrWhiteSpace($logo)) { $logo = [string]$visual.Square150x150Logo }
    if ([string]::IsNullOrWhiteSpace($logo)) { return $null }

    $relative = $logo.Replace('/', '\')
    $direct = Join-Path $package.InstallLocation $relative
    $directory = Split-Path -Parent $direct
    $stem = [IO.Path]::GetFileNameWithoutExtension($direct)
    $candidates = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $direct -PathType Leaf) { $candidates.Add($direct) }
    if (Test-Path -LiteralPath $directory -PathType Container) {
        Get-ChildItem -LiteralPath $directory -Filter ($stem + '*.png') -File -ErrorAction SilentlyContinue |
            Sort-Object @{ Expression = { if ($_.Name -match 'targetsize-64.*unplated') { 0 } elseif ($_.Name -match 'targetsize') { 1 } elseif ($_.Name -match 'scale-200') { 2 } else { 3 } } }, Name |
            ForEach-Object { $candidates.Add($_.FullName) }
    }
    $rankedCandidates = foreach ($candidate in @($candidates | Select-Object -Unique)) {
        try {
            $candidateImage = [System.Drawing.Image]::FromFile($candidate)
            try {
                $dimension = [Math]::Max($candidateImage.Width, $candidateImage.Height)
                $unplated = [IO.Path]::GetFileName($candidate) -match '(?i)unplated'
                $tier = if ($unplated -and $dimension -ge $outputSize) { 3 }
                    elseif ($dimension -ge $outputSize) { 2 }
                    elseif ($unplated) { 1 }
                    else { 0 }
                [PSCustomObject]@{ Path = $candidate; Tier = $tier; Dimension = $dimension }
            }
            finally { $candidateImage.Dispose() }
        }
        catch { }
    }
    $iconPath = $rankedCandidates |
        Sort-Object @{ Expression = 'Tier'; Descending = $true }, @{ Expression = 'Dimension'; Descending = $true }, Path |
        Select-Object -ExpandProperty Path -First 1
    if ([string]::IsNullOrWhiteSpace($iconPath)) { return $null }
    $source = [System.Drawing.Image]::FromFile($iconPath)
    try { return Convert-BitmapPng $source }
    finally { $source.Dispose() }
}

$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ItemsBase64))
$items = ConvertFrom-Json -InputObject $json
$results = New-Object System.Collections.Generic.List[object]
foreach ($item in @($items) | Select-Object -First 120) {
    try {
        $target = ''
        if (-not [string]::IsNullOrWhiteSpace([string]$item.path)) {
            $target = [string]$item.path
        }
        elseif ([int]$item.processId -gt 0) {
            $process = Get-Process -Id ([int]$item.processId) -ErrorAction Stop
            $target = $process.MainModule.FileName
        }

        $dataUri = if (-not [string]::IsNullOrWhiteSpace([string]$item.appUserModelId)) {
            Read-PackagedIconPng ([string]$item.appUserModelId)
        }
        else { Read-IconPng $target }
        if (-not [string]::IsNullOrWhiteSpace($dataUri)) {
            $results.Add([PSCustomObject]@{ key = [string]$item.key; dataUri = $dataUri })
        }
    }
    catch { }
}

$results.ToArray() | ConvertTo-Json -Depth 3 -Compress
