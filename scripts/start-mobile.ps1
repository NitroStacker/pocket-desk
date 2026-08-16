[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^https://')][string]$RelayUrl,
    [ValidatePattern('^https://')][string]$PackagerProxyUrl
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$mobileDirectory = Join-Path $workspaceRoot 'apps\mobile'

try {
    $env:EXPO_PUBLIC_RELAY_URL = $RelayUrl
    if ($PackagerProxyUrl) {
        $env:EXPO_PACKAGER_PROXY_URL = $PackagerProxyUrl.TrimEnd('/')
    }
    $env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
    $env:npm_config_strict_ssl = 'false'
    Push-Location $mobileDirectory
    try {
        if ($PackagerProxyUrl) {
            npx expo start --localhost --clear
        }
        else {
            npx expo start --tunnel --clear
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:EXPO_PUBLIC_RELAY_URL -ErrorAction SilentlyContinue
    Remove-Item Env:EXPO_PACKAGER_PROXY_URL -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
    Remove-Item Env:npm_config_strict_ssl -ErrorAction SilentlyContinue
}
