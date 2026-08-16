[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$relayDirectory = Join-Path $workspaceRoot 'services\relay'
$secretDirectory = Join-Path $workspaceRoot 'services\host\.secrets'
$encryptedSecretPath = Join-Path $secretDirectory 'admin-token.dpapi'
$temporarySecretPath = Join-Path ([System.IO.Path]::GetTempPath()) ("pocketdesk-{0}.env" -f [Guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null

$randomBytes = New-Object byte[] 32
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($randomBytes)
$randomGenerator.Dispose()
$adminToken = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
$secureToken = ConvertTo-SecureString $adminToken -AsPlainText -Force
$encryptedToken = ConvertFrom-SecureString $secureToken
Set-Content -LiteralPath $encryptedSecretPath -Value $encryptedToken -NoNewline

try {
    Set-Content -LiteralPath $temporarySecretPath -Value "ADMIN_TOKEN=$adminToken" -NoNewline
    Push-Location $relayDirectory
    try {
        npx wrangler deploy --secrets-file $temporarySecretPath
        if ($LASTEXITCODE -ne 0) {
            throw "Wrangler deployment failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    $adminToken = $null
    $secureToken.Dispose()
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
    if (Test-Path -LiteralPath $temporarySecretPath) {
        Remove-Item -LiteralPath $temporarySecretPath -Force
    }
}

Write-Output "Encrypted host credential saved for the current Windows user."
