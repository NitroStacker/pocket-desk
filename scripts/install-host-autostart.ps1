[CmdletBinding()]
param(
    [ValidatePattern('^https://')][string]$RelayUrl,
    [ValidateSet('smooth', 'balanced', 'sharp')][string]$Profile = 'balanced',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$hostScript = Join-Path $PSScriptRoot 'start-host.ps1'
$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory 'PocketDesk Host.lnk'

if ($Uninstall) {
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
    }
    Write-Output 'PocketDesk Host will no longer start when this Windows user signs in.'
    return
}

if (-not $RelayUrl) {
    throw 'Pass -RelayUrl with the deployed PocketDesk relay URL.'
}

if (-not (Test-Path -LiteralPath $hostScript)) {
    throw "PocketDesk host launcher was not found at $hostScript"
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$hostScript`" -RelayUrl `"$RelayUrl`" -Profile `"$Profile`""
$shortcut.WorkingDirectory = $workspaceRoot
$shortcut.Description = 'Start PocketDesk Host after Windows sign-in'
$shortcut.Save()

Write-Output 'PocketDesk Host will now start automatically after this Windows user signs in.'
Write-Output "Startup shortcut: $shortcutPath"
