[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RuntimeRoot,
    [string]$DatabaseConfig,
    [int]$WebPort = 18080,
    [int]$ApplicationPort = 18020,
    [int]$CenterPort = 18030
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.local'))
$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
if (!$runtime.StartsWith($localRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw '隔离运行目录必须位于本项目 .local 内。'
}
if (!$DatabaseConfig) { $DatabaseConfig = Join-Path $localRoot 'secrets\mariadb-integration.json' }
$db = Get-Content -LiteralPath $DatabaseConfig -Raw -Encoding UTF8 | ConvertFrom-Json
if ($db.status -ne 'ready' -or $db.host -ne '127.0.0.1' -or $db.database -notmatch '^companyoait\d{8}[a-f0-9]{8}$' -or $db.user -notmatch '^oa_it_[a-f0-9]{8}$') {
    throw '只允许使用已验证的独立联调库及专用账号。'
}
$ports = @($WebPort, $ApplicationPort, $CenterPort)
if (@($ports | Select-Object -Unique).Count -ne 3 -or @($ports | Where-Object { $_ -lt 1024 -or $_ -gt 65535 }).Count) {
    throw '需指定三个互不相同的有效非特权测试端口。'
}
$marker = Join-Path $runtime 'integration-environment.json'
if (Test-Path -LiteralPath $marker) { throw '联调环境已初始化，本工具不会覆盖既有 token 或数据库配置。' }
if (!(Test-Path -LiteralPath (Join-Path $runtime 'console.jar'))) { throw '运行目录缺少本仓库构建的 console.jar。' }
New-Item -ItemType Directory -Path (Join-Path $runtime 'config') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $runtime 'local') -Force | Out-Null

function Write-PrivateJson([string]$RelativePath, $Value) {
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runtime $RelativePath) -Encoding utf8
}
$node = [ordered]@{
    enable = $true; autoStart = $true; nodeAgentEnable = $false
    center = @{ enable = $true; port = $CenterPort; sslEnable = $false; proxyHost = '127.0.0.1'; proxyPort = $CenterPort }
    application = @{
        enable = $true; port = $ApplicationPort; sslEnable = $false; proxyHost = '127.0.0.1'; proxyPort = $ApplicationPort
        includes = @('com.x.base.core.project.x_organization_*', 'com.x.base.core.project.x_processplatform_*', 'com.x.base.core.project.x_query_*', 'com.x.base.core.project.x_program_center', 'com.x.base.core.project.x_correlation_service_processing', 'com.x.base.core.project.x_message_assemble_communicate')
        excludes = @()
    }
    web = @{ enable = $true; port = $WebPort; sslEnable = $false; proxyHost = '127.0.0.1'; proxyPort = $WebPort; proxyCenterEnable = $true; proxyApplicationEnable = $true }
    data = @{ enable = $false }
    storage = @{ enable = $false }
    dumpData = @{ enable = $false }
    restoreData = @{ enable = $false }
    stackTrace = @{ enable = $false }
}
Write-PrivateJson 'config\node_127.0.0.1.json' $node
[IO.File]::WriteAllText((Join-Path $runtime 'local\node.cfg'), '127.0.0.1', [Text.UTF8Encoding]::new($false))
$adminPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
Write-PrivateJson 'config\token.json' @{ key = [Guid]::NewGuid().ToString('N'); password = $adminPassword; rsaEnable = $false }
Write-PrivateJson 'config\person.json' @{ firstLoginModifyPwd = $false; codeLogin = $false; bindLogin = $false; enableSafeLogout = $true; mobileRegex = '^IT[0-9a-f]{8}[AB]$' }
# This is a connectivity profile, with no notification consumers or callbacks.
# Enumerate this pinned source's message types so omitted fields cannot fall back
# to enabled default consumers (including mobile push services not deployed here).
$messagesSource = [IO.File]::ReadAllText((Join-Path $projectRoot 'o2server\x_base_core_project\src\main\java\com\x\base\core\project\config\Messages.java'))
$messageProfile = @{ consumers = @{} }
foreach ($match in [regex]::Matches($messagesSource, 'private Message ([A-Za-z0-9_]+)\s*;')) {
    $messageProfile[$match.Groups[1].Value] = @{ consumers = @() }
}
if ($messageProfile.Count -lt 2) { throw '无法生成当前源码的无通知测试配置。' }
Write-PrivateJson 'config\messages.json' $messageProfile
$url = "jdbc:mysql://127.0.0.1:$($db.port)/$($db.database)?useSSL=false&useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia%2FShanghai"
$sources = @(@{
    enable = $true; url = $url; username = $db.user; password = $db.password
    driverClassName = 'com.mysql.cj.jdbc.Driver'
    dictionary = 'com.x.base.core.openjpa.jdbc.sql.CompanyOaMySQLDictionary(clobTypeName=LONGTEXT,blobTypeName=LONGBLOB,maxIndexesPerTable=64,batchLimit=50)'
    schema = ''; includes = @(); excludes = @(); maxTotal = 20; maxIdle = 2; logLevel = 'ERROR'; transactionIsolation = 'read-committed'
})
ConvertTo-Json -InputObject $sources -Depth 8 | Set-Content -LiteralPath (Join-Path $runtime 'config\externalDataSources.json') -Encoding utf8
$environment = [ordered]@{
    version = 1; runtimeRoot = $runtime; host = '127.0.0.1'; webPort = $WebPort; applicationPort = $ApplicationPort; centerPort = $CenterPort
    database = $db.database; databaseUser = $db.user; adminCredential = 'xadmin'; adminPassword = $adminPassword
    databaseConfigPath = [IO.Path]::GetFullPath($DatabaseConfig)
    nodeAgentEnabled = $false; embeddedDatabaseEnabled = $false; ftpStorageEnabled = $false
}
Write-PrivateJson 'integration-environment.json' $environment
[pscustomobject]@{ initialized = $true; runtimeRoot = $runtime; database = $db.database; ports = $ports; credentialsPrinted = $false } | ConvertTo-Json
