param(
    [string]$Path = '',
    [string]$AppName = '',
    [string]$AppUserModelId = ''
)

$ErrorActionPreference = 'Stop'
if (-not [string]::IsNullOrWhiteSpace($AppUserModelId)) {
    if ($AppUserModelId -notmatch '^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$') { throw 'The packaged app identifier is invalid.' }
    Start-Process -FilePath explorer.exe -ArgumentList ('shell:AppsFolder\' + $AppUserModelId)
    exit 0
}
if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'The selected item is no longer available.'
}

if ($AppName -eq 'File Explorer') {
    Start-Process -FilePath explorer.exe
}
else {
    Start-Process -FilePath $Path
}
