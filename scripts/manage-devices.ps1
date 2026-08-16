[CmdletBinding(DefaultParameterSetName = 'List')]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^https://')][string]$RelayUrl,
    [Parameter(ParameterSetName = 'Add', Mandatory = $true)][switch]$Add,
    [Parameter(ParameterSetName = 'Add', Mandatory = $true)][ValidateLength(1, 64)][string]$Name,
    [Parameter(ParameterSetName = 'Remove', Mandatory = $true)][switch]$Remove,
    [Parameter(ParameterSetName = 'Remove', Mandatory = $true)][ValidatePattern('^[a-fA-F0-9-]{36}$')][string]$DeviceId
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$commandArguments = @('run', 'devices', '--workspace', '@pocketdesk/host', '--')

switch ($PSCmdlet.ParameterSetName) {
    'Add' { $commandArguments += @('add', $Name) }
    'Remove' { $commandArguments += @('remove', $DeviceId) }
    default { $commandArguments += 'list' }
}
$commandArguments += @('--relay', $RelayUrl)

Push-Location $workspaceRoot
try {
    & npm.cmd @commandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "PocketDesk device manager failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
