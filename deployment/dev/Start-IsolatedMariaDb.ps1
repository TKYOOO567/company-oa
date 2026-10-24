[CmdletBinding()]
param([string]$MariaDbBin = 'C:\Program Files\MariaDB 12.3\bin', [int]$Port = 13306, [switch]$Resume)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = Join-Path $projectRoot '.local'
$instance = Join-Path $localRoot 'runtime\mariadb-integration'
$secrets = Join-Path $localRoot 'secrets'
$adminFile = Join-Path $secrets 'mariadb-isolated-admin.json'
if ($Port -lt 1024 -or $Port -gt 65535) { throw '测试端口无效。' }
if (!$Resume -and ((Test-Path -LiteralPath $instance) -or (Test-Path -LiteralPath $adminFile))) {
    throw '隔离实例目录或凭据已存在。本工具不会初始化覆盖或重置；请核查前次状态。'
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw '测试端口已占用。' }
$installer = Join-Path $MariaDbBin 'mariadb-install-db.exe'
$server = Join-Path $MariaDbBin 'mariadbd.exe'
if (!(Test-Path -LiteralPath $installer) -or !(Test-Path -LiteralPath $server)) { throw '缺少本机 MariaDB 程序。' }
$data = Join-Path $instance 'data'
$initFile = Join-Path $secrets 'mariadb-isolated-init.sql'
$config = Join-Path $instance 'my.ini'
if (!$Resume) {
New-Item -ItemType Directory -Path $instance, $secrets -Force | Out-Null
$bootstrapLog = Join-Path $instance 'bootstrap.log'
& $installer "--datadir=$data" "--port=$Port" --silent *> $bootstrapLog
if ($LASTEXITCODE -ne 0) { throw '独立数据目录初始化失败，日志已保留。' }
$password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
$admin = @{host='127.0.0.1'; port=$Port; user='oa_it_admin'; password=$password; isolatedInstance=$instance}
$admin | ConvertTo-Json | Set-Content -LiteralPath $adminFile -Encoding utf8
# This SQL runs during startup, before the server accepts connections. Passwords
# are never put on command lines. All users belong to this newly created instance.
$initSql = "SET PASSWORD FOR 'root'@'localhost' = PASSWORD('$password');`nCREATE USER 'oa_it_admin'@'127.0.0.1' IDENTIFIED BY '$password';`nGRANT ALL PRIVILEGES ON *.* TO 'oa_it_admin'@'127.0.0.1' WITH GRANT OPTION;"
[IO.File]::WriteAllText($initFile, $initSql, [Text.UTF8Encoding]::new($false))
$ini = @"
[mysqld]
basedir=$((Split-Path $MariaDbBin -Parent).Replace('\','/'))
datadir=$($data.Replace('\','/'))
port=$Port
bind-address=127.0.0.1
skip-name-resolve
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
innodb-buffer-pool-size=128M
max-connections=60
"@
[IO.File]::WriteAllText($config, $ini, [Text.UTF8Encoding]::new($false))
} else {
    $admin = Get-Content -LiteralPath $adminFile -Raw | ConvertFrom-Json
    if ($admin.isolatedInstance -ne $instance -or $admin.port -ne $Port -or !(Test-Path -LiteralPath $config)) { throw '无法核对前次隔离实例。' }
}
$arguments = @(("--defaults-file=$config"), '--console')
if ((Get-Item -LiteralPath $initFile -ErrorAction SilentlyContinue).Length -gt 0) { $arguments += "--init-file=$initFile" }
$arguments = $arguments | ForEach-Object { '"' + $_ + '"' }
$process = Start-Process -FilePath $server -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $instance 'stdout.log') -RedirectStandardError (Join-Path $instance 'stderr.log')
@{pid=$process.Id; server=$server; instance=$instance; port=$Port; configPath=$config; startedAt=[DateTimeOffset]::UtcNow.ToString('o')} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $instance 'process.json') -Encoding utf8
Import-Module (Join-Path $PSScriptRoot 'MariaDb.Client.psm1') -Force
$result = $null
for ($attempt=0; $attempt -lt 60; $attempt++) {
    if ($process.HasExited) { throw '独立 MariaDB 启动失败，查看该实例的私有日志。' }
    $listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listening -and @($listening | Where-Object OwningProcess -ne $process.Id).Count) { throw '端口归属异常，停止连接。' }
    if ($listening) {
        $result = Invoke-LocalMariaDbSql -Connection $admin -Sql 'SELECT VERSION();' -SecretRoot $secrets -ClientPath (Join-Path $MariaDbBin 'mariadb.exe')
        if ($result.Code -eq 0 -and $result.Output -match 'MariaDB') { break }
    }
    Start-Sleep -Milliseconds 500
}
if (!$result -or $result.Code -ne 0) { throw '隔离实例的带密码连接未通过，日志已保留。' }
[IO.File]::WriteAllText($initFile, '', [Text.UTF8Encoding]::new($false))
[pscustomobject]@{started=$true; version=$result.Output.Trim(); pid=$process.Id; host='127.0.0.1'; port=$Port; adminConfigPath=$adminFile; existingServiceModified=$false} | ConvertTo-Json
