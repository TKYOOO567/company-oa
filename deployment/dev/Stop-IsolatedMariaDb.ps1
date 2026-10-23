[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = Join-Path $projectRoot '.local'
$instance = Join-Path $localRoot 'runtime\mariadb-integration'
$marker = Get-Content -LiteralPath (Join-Path $instance 'process.json') -Raw | ConvertFrom-Json
$admin = Get-Content -LiteralPath (Join-Path $localRoot 'secrets\mariadb-isolated-admin.json') -Raw | ConvertFrom-Json
$processId = [int]$marker.pid
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
if (!$processInfo) { [pscustomobject]@{ stopped=$true; alreadyExited=$true; pid=$processId } | ConvertTo-Json; return }
if ($marker.instance -ne $instance -or $admin.isolatedInstance -ne $instance -or $marker.port -ne $admin.port -or $processInfo.ExecutablePath -ne $marker.server -or $processInfo.CommandLine.IndexOf($marker.configPath,[StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw '无法核对隔离进程归属，未发送停止指令。'
}
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $admin.port -ErrorAction SilentlyContinue)
if ($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $processId -or $listeners[0].LocalAddress -ne '127.0.0.1') { throw '隔离端口归属不能确认。' }
Import-Module (Join-Path $PSScriptRoot 'MariaDb.Client.psm1') -Force
$result = Invoke-LocalMariaDbSql -Connection $admin -Sql 'SHUTDOWN;' -SecretRoot (Join-Path $localRoot 'secrets') -ClientPath (Join-Path (Split-Path $marker.server) 'mariadb.exe')
if ($result.Code -ne 0) { throw '隔离实例未接受正常关闭命令。' }
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if ($process -and !$process.WaitForExit(30000)) { throw '数据库仍在关闭，未强制终止。' }
[pscustomobject]@{ stopped=$true; pid=$processId; method='MariaDB SHUTDOWN'; existingServiceModified=$false } | ConvertTo-Json
