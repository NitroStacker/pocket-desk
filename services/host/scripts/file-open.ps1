[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = 'Stop'
$resolved = Resolve-Path -LiteralPath $Path
Invoke-Item -LiteralPath $resolved.Path
