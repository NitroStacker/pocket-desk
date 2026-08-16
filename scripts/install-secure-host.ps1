[CmdletBinding()]
param(
    [ValidateSet('smooth', 'balanced', 'sharp')][string]$Profile = 'balanced',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$serviceName = 'PocketDeskSecureHost'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $workspaceRoot 'services\windows-service\PocketDesk.SecureHost.csproj'
$publishPath = Join-Path $workspaceRoot 'services\windows-service\dist\win-x64'
$installRoot = Join-Path $env:ProgramFiles 'PocketDesk\SecureHost'
$installedExe = Join-Path $installRoot 'PocketDesk.SecureHost.exe'
$programDataRoot = Join-Path $env:ProgramData 'PocketDesk'
$machineConfigPath = Join-Path $programDataRoot 'secure-host.dpapi'
$userConfigPath = Join-Path $env:LOCALAPPDATA 'PocketDesk\host-session.dpapi'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as Administrator, then run this installer again.'
}

if ($Uninstall) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $service) {
        if ($service.Status -ne 'Stopped') {
            Stop-Service -Name $serviceName -Force
            $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(15))
        }
        & sc.exe delete $serviceName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Windows could not remove the $serviceName service." }
    }
    if (Test-Path -LiteralPath $installRoot) {
        $resolvedInstall = [IO.Path]::GetFullPath($installRoot)
        $resolvedProgramFiles = [IO.Path]::GetFullPath($env:ProgramFiles).TrimEnd('\') + '\'
        if (-not $resolvedInstall.StartsWith($resolvedProgramFiles, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove an unexpected install path: $resolvedInstall"
        }
        Remove-Item -LiteralPath $resolvedInstall -Recurse -Force
    }
    if (Test-Path -LiteralPath $machineConfigPath) {
        Remove-Item -LiteralPath $machineConfigPath -Force
    }
    Write-Output 'PocketDesk secure sign-in access was removed. The regular current-user host enrollment was kept.'
    return
}

if (-not (Test-Path -LiteralPath $userConfigPath)) {
    throw 'No persistent PocketDesk host enrollment was found. Start the regular host once before installing secure sign-in access.'
}

$encryptedEnrollment = Get-Content -Raw -LiteralPath $userConfigPath
$secureEnrollment = ConvertTo-SecureString $encryptedEnrollment
$enrollmentPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureEnrollment)
try {
    $enrollmentJson = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($enrollmentPointer)
    $enrollment = $enrollmentJson | ConvertFrom-Json
    if ($enrollment.persistent -ne $true -or
        $enrollment.relayUrl -notmatch '^https://' -or
        $enrollment.sessionId -notmatch '^[a-f0-9-]{36}$' -or
        $enrollment.hostToken -notmatch '^[a-f0-9]{64}$') {
        throw 'The saved host enrollment is not a valid persistent PocketDesk session.'
    }

    & dotnet publish $projectPath -c Release -r win-x64 --self-contained true -o $publishPath
    if ($LASTEXITCODE -ne 0) { throw "Secure host publish failed with exit code $LASTEXITCODE." }

    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $existing -and $existing.Status -ne 'Stopped') {
        Stop-Service -Name $serviceName -Force
        $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(15))
    }

    New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
    Copy-Item -Path (Join-Path $publishPath '*') -Destination $installRoot -Recurse -Force

    New-Item -ItemType Directory -Force -Path $programDataRoot | Out-Null
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $children = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $directoryAcl = New-Object Security.AccessControl.DirectorySecurity
    $directoryAcl.SetAccessRuleProtection($true, $false)
    $directoryAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM', 'FullControl', $children, $propagation, $allow)))
    $directoryAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $children, $propagation, $allow)))
    Set-Acl -LiteralPath $programDataRoot -AclObject $directoryAcl

    $machineJson = @{
        relayUrl = [string]$enrollment.relayUrl
        sessionId = [string]$enrollment.sessionId
        hostToken = [string]$enrollment.hostToken
    } | ConvertTo-Json -Compress
    $machineJson | & $installedExe --write-config | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The secure host could not protect its machine enrollment.' }

    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM', 'FullControl', $inheritance, $propagation, $allow)))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $inheritance, $propagation, $allow)))
    Set-Acl -LiteralPath $machineConfigPath -AclObject $acl

    $binaryPath = "`"$installedExe`" --service"
    if ($null -eq $existing) {
        New-Service -Name $serviceName -BinaryPathName $binaryPath -DisplayName 'PocketDesk Secure Host' -Description 'Provides trusted PocketDesk devices with restricted Windows sign-in screen access.' -StartupType Automatic | Out-Null
    }
    else {
        & sc.exe config $serviceName "binPath= $binaryPath" 'start= auto' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Windows could not update the $serviceName service." }
    }
    & sc.exe failure $serviceName 'reset= 86400' 'actions= restart/5000/restart/15000/restart/60000' | Out-Null
    & sc.exe failureflag $serviceName 1 | Out-Null
    & sc.exe description $serviceName 'Restricted PocketDesk screen and input access for the Windows sign-in desktop.' | Out-Null

    & (Join-Path $PSScriptRoot 'install-host-autostart.ps1') -RelayUrl ([string]$enrollment.relayUrl) -Profile $Profile
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
}
finally {
    if ($enrollmentPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($enrollmentPointer)
    }
    $secureEnrollment.Dispose()
    $enrollmentJson = $null
    $machineJson = $null
}

Write-Output 'PocketDesk secure sign-in access is installed and running.'
Write-Output 'It starts before Windows sign-in; the regular PocketDesk host starts after this user signs in.'
