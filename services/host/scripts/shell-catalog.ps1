$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$sources = @(
    [PSCustomObject]@{
        Path = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
        Pinned = $true
        Category = 'Taskbar'
    },
    [PSCustomObject]@{
        Path = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
        Pinned = $false
        Category = 'Start menu'
    },
    [PSCustomObject]@{
        Path = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'
        Pinned = $false
        Category = 'Start menu'
    }
)

$entries = New-Object System.Collections.Generic.List[object]
$defaultAuroraFxPath = 'C:\Users\retro\Documents\Codex\2026-08-16\i-have-an-alienware-r15-pc\publish\AuroraFxControl.exe'
$auroraFxPath = if ([string]::IsNullOrWhiteSpace($env:POCKETDESK_AURORA_FX_PATH)) {
    $defaultAuroraFxPath
}
else {
    [Environment]::ExpandEnvironmentVariables($env:POCKETDESK_AURORA_FX_PATH.Trim().Trim('"'))
}
if (Test-Path -LiteralPath $auroraFxPath -PathType Leaf) {
    $entries.Add([PSCustomObject]@{
        name = 'Aurora FX'
        category = 'Lighting'
        pinned = $true
        shortcutPath = $auroraFxPath
        targetPath = $auroraFxPath
        iconPath = Join-Path $PSScriptRoot '..\assets\aurora-fx-control.png'
        arguments = ''
    })
}

$shortcutReader = New-Object -ComObject WScript.Shell
foreach ($source in $sources) {
    if (-not (Test-Path -LiteralPath $source.Path)) { continue }

    Get-ChildItem -LiteralPath $source.Path -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object {
            $name = $_.BaseName.Trim()
            if ([string]::IsNullOrWhiteSpace($name)) { return }
            if ($name -match '(?i)^(uninstall|remove|repair)\b|\b(uninstall|readme|documentation|website)$') { return }

            $category = $source.Category
            if (-not $source.Pinned) {
                $relative = $_.DirectoryName.Substring($source.Path.Length).TrimStart('\')
                if (-not [string]::IsNullOrWhiteSpace($relative)) {
                    $category = ($relative -split '\\')[0]
                }
            }

            $targetPath = ''
            $arguments = ''
            try {
                $shortcut = $shortcutReader.CreateShortcut($_.FullName)
                $targetPath = [string]$shortcut.TargetPath
                $arguments = [string]$shortcut.Arguments
            }
            catch { }

            $entries.Add([PSCustomObject]@{
                name = $name.Substring(0, [Math]::Min(120, $name.Length))
                category = $category.Substring(0, [Math]::Min(80, $category.Length))
                pinned = [bool]$source.Pinned
                shortcutPath = $_.FullName
                targetPath = $targetPath
                arguments = $arguments
            })
        }
}

Get-StartApps -ErrorAction SilentlyContinue |
    Where-Object { $_.AppID -match '^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$' } |
    ForEach-Object {
        $name = ([string]$_.Name).Trim()
        $appId = ([string]$_.AppID).Trim()
        if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($appId)) { return }
        $entries.Add([PSCustomObject]@{
            name = $name.Substring(0, [Math]::Min(120, $name.Length))
            category = 'Packaged app'
            pinned = $false
            shortcutPath = ''
            targetPath = ''
            arguments = ''
            appUserModelId = $appId
        })
    }

$byName = @{}
foreach ($entry in @($entries | Sort-Object @{ Expression = 'pinned'; Descending = $true }, name)) {
    $key = $entry.name.ToLowerInvariant()
    if (-not $byName.ContainsKey($key)) { $byName[$key] = $entry }
}

@($byName.Values | Sort-Object @{ Expression = 'pinned'; Descending = $true }, name | Select-Object -First 450) |
    ConvertTo-Json -Depth 4 -Compress
