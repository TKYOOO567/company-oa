[CmdletBinding()]
param([Parameter(Mandatory)][string]$RuntimeRoot, [ValidateSet('Pending','Completed')][string]$Stage = 'Pending')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = Join-Path $projectRoot '.local'
$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
if (!$runtime.StartsWith($localRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '运行目录必须在项目 .local 内。' }
$environment = Get-Content -LiteralPath (Join-Path $runtime 'integration-environment.json') -Raw | ConvertFrom-Json
$databaseConfig = if ($environment.databaseConfigPath) { [IO.Path]::GetFullPath($environment.databaseConfigPath) } else { Join-Path $localRoot 'secrets\mariadb-integration.json' }
if (!$databaseConfig.StartsWith($localRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '数据库配置路径必须位于本工程 .local 内。' }
$db = Get-Content -LiteralPath $databaseConfig -Raw | ConvertFrom-Json
$seed = Get-Content -LiteralPath (Join-Path $runtime 'integration-seed.json') -Raw | ConvertFrom-Json
if ($db.status -ne 'ready' -or $db.database -notmatch '^companyoait\d{8}[a-f0-9]{8}$' -or $environment.database -ne $db.database -or $seed.suffix -notmatch '^[a-f0-9]{8}$') { throw '不能核对独立测试库来源。' }
if ($seed.ids.task -notmatch '^[a-f0-9-]{36}$' -or $seed.ids.work -notmatch '^[a-f0-9-]{36}$') { throw '缺少真实流程及任务标识。' }
$title = 'IT-SMOKE-' + $seed.suffix
Import-Module (Join-Path $PSScriptRoot 'MariaDb.Client.psm1') -Force
$sql = @"
USE ``$($db.database)``;
SELECT 'catalog', DATABASE();
SELECT 'tables', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();
SELECT 'platformConnections', COUNT(*) FROM information_schema.processlist WHERE DB = DATABASE() AND ID <> CONNECTION_ID();
SELECT 'pending', COUNT(*) FROM PP_C_TASK WHERE xtitle = '$title';
SELECT 'work', COUNT(*) FROM PP_C_WORK WHERE xtitle = '$title';
SELECT 'taskCompleted', COUNT(*) FROM PP_C_TASKCOMPLETED WHERE xtitle = '$title';
SELECT 'workCompleted', COUNT(*) FROM PP_C_WORKCOMPLETED WHERE xtitle = '$title';
SELECT 'knownPending', COUNT(*) FROM PP_C_TASK WHERE xid = '$($seed.ids.task)' AND xwork = '$($seed.ids.work)' AND xtitle = '$title';
"@
$result = Invoke-LocalMariaDbSql -Connection $db -Sql $sql -SecretRoot (Join-Path $localRoot 'secrets')
if ($result.Code -ne 0) { throw 'MariaDB 中的实际平台表/流程查询失败。' }
$counts = @{}
foreach ($line in ($result.Output.Trim() -split "`r?`n")) {
    $parts = $line -split "`t", 2
    if ($parts.Count -ne 2) { throw '数据库证据响应格式错误。' }
    $counts[$parts[0]] = $parts[1]
}
if ($counts.catalog -ne $db.database -or [int]$counts.tables -lt 4 -or [int]$counts.platformConnections -lt 1) { throw '数据库 catalog、平台表或平台持有连接核对失败。' }
if ($Stage -eq 'Pending') {
    if ([int]$counts.pending -ne 1 -or [int]$counts.work -ne 1 -or [int]$counts.knownPending -ne 1 -or [int]$counts.taskCompleted -lt 1) { throw '真实待办、在途工作或发起节点已办记录核对失败。' }
} else {
    if ([int]$counts.pending -ne 0 -or [int]$counts.work -ne 0 -or [int]$counts.taskCompleted -lt 2 -or [int]$counts.workCompleted -ne 1) { throw '真实流程结束后的数据库状态不符。' }
}
$receipt = [ordered]@{ passed=$true; stage=$Stage; database=$db.database; port=$db.port; counts=$counts; checkedAt=[DateTimeOffset]::UtcNow.ToString('o') }
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runtime "database-$($Stage.ToLowerInvariant())-verification.json") -Encoding utf8
$receipt | ConvertTo-Json -Depth 5
