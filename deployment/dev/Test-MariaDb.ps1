#requires -Version 7.0
<#
.SYNOPSIS
Inspect a local MariaDB Windows service; optionally attempt its authorized startup.
.DESCRIPTION
Does not authenticate, guess credentials, reset passwords, change startup type,
create a second server process, or modify any database. No automatic elevation.
#>
[CmdletBinding()]
param(
    [string] $ServiceName = 'MariaDB',
    [switch] $StartService,
    [switch] $RequireRunning
)
$ErrorActionPreference = 'Stop'
$service = Get-CimInstance Win32_Service | Where-Object Name -eq $ServiceName | Select-Object -First 1
if (-not $service) { throw 'The requested Windows service was not found.' }
if ($service.Name -notmatch 'maria|mysql' -and $service.DisplayName -notmatch 'maria|mysql') {
    throw 'The requested service is not identified as MariaDB/MySQL.'
}
$executable = $null
if ($service.PathName -match '^"([^"]+)"') { $executable = $Matches[1] }
elseif ($service.PathName -match '^([^\s]+)') { $executable = $Matches[1] }
$defaultsFile = $null
if ($service.PathName -match '--defaults-file(?:=|\s+)"?(.+?\.ini)') { $defaultsFile = $Matches[1].Trim('"') }
$port = $null
$credentialKeyNames = @()
if ($defaultsFile -and (Test-Path -LiteralPath $defaultsFile -PathType Leaf)) {
    $configLines = @(Get-Content -LiteralPath $defaultsFile)
    $portLine = $configLines | Where-Object { $_ -match '^\s*port\s*=\s*(\d+)\s*$' } | Select-Object -First 1
    if ($portLine -match '=\s*(\d+)') { $port = [int]$Matches[1] }
    $credentialKeyNames = @($configLines | Where-Object { $_ -match '^\s*(user|password)\s*=' } |
        ForEach-Object { ($_ -split '=', 2)[0].Trim() } | Sort-Object -Unique)
}
$version = $null
if ($executable -and (Test-Path -LiteralPath $executable -PathType Leaf)) {
    $version = ((& $executable --version 2>&1) | Out-String).Trim()
}
$startup = [ordered]@{ requested = [bool]$StartService; attempted = $false; succeeded = $false; error = $null }
if ($StartService -and $service.State -ne 'Running') {
    $startup.attempted = $true
    try {
        Start-Service -Name $service.Name -ErrorAction Stop
        (Get-Service -Name $service.Name).WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
        $startup.succeeded = $true
    } catch { $startup.error = $_.Exception.GetType().Name + ': ' + $_.Exception.Message }
}
$current = Get-CimInstance Win32_Service | Where-Object Name -eq $service.Name | Select-Object -First 1
$listeners = @()
if ($port) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, OwningProcess)
}
$serviceListenerFound = $current.State -eq 'Running' -and $current.ProcessId -gt 0 -and
    @($listeners | Where-Object OwningProcess -eq $current.ProcessId).Count -gt 0
[ordered]@{
    recordedAt = [DateTimeOffset]::Now.ToString('o')
    service = @{ name = $current.Name; state = $current.State; startMode = $current.StartMode; processId = $current.ProcessId }
    executable = $executable
    version = $version
    configSource = $defaultsFile
    configuredPort = $port
    credentialKeyNamesOnly = $credentialKeyNames
    startup = $startup
    listeners = $listeners
    serviceListenerFound = $serviceListenerFound
    authenticatedConnectionVerified = $false
    jdbcCompatibilityVerified = $false
    databaseModified = $false
    note = 'Service/port evidence is not an authenticated database or JDBC compatibility test. No credential values are printed.'
} | ConvertTo-Json -Depth 7
if ($RequireRunning -and -not $serviceListenerFound) { exit 2 }
exit 0
