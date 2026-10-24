[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$AdminConfig,
    [string]$OutputConfig,
    [string]$ClientPath = 'C:\Program Files\MariaDB 12.3\bin\mariadb.exe'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$secretRoot = Join-Path $projectRoot '.local\secrets'
New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null
$outputFile = if ($OutputConfig) { [IO.Path]::GetFullPath($OutputConfig) } else { Join-Path $secretRoot 'mariadb-integration.json' }
if (!$outputFile.StartsWith($secretRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '数据库配置必须位于本工程 .local/secrets 内。' }
if (Test-Path -LiteralPath $outputFile) {
    throw '测试库配置已存在。请先核对该配置和前次状态；本工具不会覆盖或重置账号。'
}
$admin = Get-Content -LiteralPath $AdminConfig -Raw -Encoding UTF8 | ConvertFrom-Json
if ($admin.host -ne '127.0.0.1' -or $admin.port -lt 1 -or $admin.port -gt 65535 -or [string]::IsNullOrWhiteSpace($admin.user)) {
    throw '管理员配置必须使用 127.0.0.1、有效端口及明确账号。'
}
if (!(Test-Path -LiteralPath $ClientPath -PathType Leaf)) { throw '未找到 MariaDB 客户端。' }

Import-Module (Join-Path $PSScriptRoot 'MariaDb.Client.psm1') -Force
function Invoke-LocalSql($Connection, [string]$Sql) {
    Invoke-LocalMariaDbSql -Connection $Connection -Sql $Sql -SecretRoot $secretRoot -ClientPath $ClientPath
}

$probe = Invoke-LocalSql $admin 'SELECT VERSION();'
if ($probe.Code -ne 0) { throw '无法使用提供的管理员配置连接 MariaDB。未创建测试库或账号。' }
if ($probe.Output -notmatch 'MariaDB') { throw '连接端点未报告 MariaDB 版本，停止建库。' }
$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$schema = 'companyoait' + ([TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'China Standard Time').ToString('yyyyMMdd')) + $suffix
$username = 'oa_it_' + $suffix
$password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
$connection = [ordered]@{
    host = '127.0.0.1'; port = [int]$admin.port; user = $username; password = $password
    database = $schema; status = 'provisioning'; createdAt = [DateTimeOffset]::UtcNow.ToString('o')
}
$connection | ConvertTo-Json | Set-Content -LiteralPath $outputFile -Encoding utf8
$sql = "CREATE DATABASE ``$schema`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`nCREATE USER '$username'@'127.0.0.1' IDENTIFIED BY '$password';`nGRANT ALL PRIVILEGES ON ``$schema``.* TO '$username'@'127.0.0.1';"
$provision = Invoke-LocalSql $admin $sql
if ($provision.Code -ne 0) {
    $connection.status = 'provisioning-failed'
    $connection | ConvertTo-Json | Set-Content -LiteralPath $outputFile -Encoding utf8
    throw '独立库或账号创建失败。已保存生成名称以便核查；未重置或删除任何既有对象。'
}
$test = Invoke-LocalSql $connection "USE ``$schema``; SELECT DATABASE();"
if ($test.Code -ne 0 -or $test.Output.Trim() -ne $schema) { throw '专用账号未能访问指定测试库。' }
$denied = Invoke-LocalSql $connection 'SELECT 1 FROM mysql.user LIMIT 0;'
if ($denied.Code -eq 0 -or $denied.Error -notmatch '1142|1143|1044') { throw '专用账号的跨库拒绝验证未通过，停止平台接入。' }
$connection.status = 'ready'
$connection | ConvertTo-Json | Set-Content -LiteralPath $outputFile -Encoding utf8
[pscustomobject]@{ database = $schema; user = $username; host = '127.0.0.1'; port = $admin.port; connected = $true; systemTableAccessDenied = $true; configPath = $outputFile } | ConvertTo-Json
