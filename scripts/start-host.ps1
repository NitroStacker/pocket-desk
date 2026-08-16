[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^https://')][string]$RelayUrl,
    [ValidateRange(1, 24)][int]$Expires = 12,
    [ValidateSet('smooth', 'balanced', 'sharp')][string]$Profile = 'balanced'
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$encryptedSecretPath = Join-Path $workspaceRoot 'services\host\.secrets\admin-token.dpapi'

if (-not (Test-Path -LiteralPath $encryptedSecretPath)) {
    throw 'The encrypted host credential is missing. Run scripts\provision-relay.ps1 first.'
}

$encryptedToken = Get-Content -Raw -LiteralPath $encryptedSecretPath
$secureToken = ConvertTo-SecureString $encryptedToken
$credentialPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
    $env:POCKETDESK_RELAY_URL = $RelayUrl
    $env:POCKETDESK_ADMIN_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($credentialPointer)
    Push-Location $workspaceRoot
    try {
        npm run start --workspace @pocketdesk/host -- --expires $Expires --profile $Profile
    }
    finally {
        Pop-Location
    }
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($credentialPointer)
    $secureToken.Dispose()
    Remove-Item Env:POCKETDESK_ADMIN_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:POCKETDESK_RELAY_URL -ErrorAction SilentlyContinue
}
