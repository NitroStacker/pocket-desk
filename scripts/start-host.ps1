[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^https://')][string]$RelayUrl,
    [ValidateRange(1, 24)][int]$Expires = 12,
    [ValidateSet('smooth', 'balanced', 'sharp')][string]$Profile = 'balanced',
    [switch]$Temporary,
    [switch]$ResetPairing
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$encryptedSecretPath = Join-Path $workspaceRoot 'services\host\.secrets\admin-token.dpapi'

$secureToken = $null
$credentialPointer = [IntPtr]::Zero

try {
    $env:POCKETDESK_RELAY_URL = $RelayUrl
    if (Test-Path -LiteralPath $encryptedSecretPath) {
        $encryptedToken = Get-Content -Raw -LiteralPath $encryptedSecretPath
        $secureToken = ConvertTo-SecureString $encryptedToken
        $credentialPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
        $env:POCKETDESK_ADMIN_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($credentialPointer)
    }
    Push-Location $workspaceRoot
    try {
        $hostArguments = @(
            'run', 'start', '--workspace', '@pocketdesk/host', '--',
            '--expires', $Expires,
            '--profile', $Profile
        )
        if ($Temporary) { $hostArguments += @('--temporary', 'true') }
        if ($ResetPairing) { $hostArguments += @('--reset-pairing', 'true') }
        & npm.cmd @hostArguments
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($credentialPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($credentialPointer)
    }
    if ($null -ne $secureToken) { $secureToken.Dispose() }
    Remove-Item Env:POCKETDESK_ADMIN_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:POCKETDESK_RELAY_URL -ErrorAction SilentlyContinue
}
