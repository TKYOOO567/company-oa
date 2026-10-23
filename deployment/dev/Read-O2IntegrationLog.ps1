[CmdletBinding()]
param([Parameter(Mandatory)][string]$RuntimeRoot, [ValidateRange(1,500)][int]$Tail = 40)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = Join-Path $projectRoot '.local'
$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
if (!$runtime.StartsWith($localRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '仅允许项目内的私有联调日志。' }
$values = [Collections.Generic.List[string]]::new()
$environment = Get-Content -LiteralPath (Join-Path $runtime 'integration-environment.json') -Raw | ConvertFrom-Json
$databaseConfig = if ($environment.databaseConfigPath) { [IO.Path]::GetFullPath($environment.databaseConfigPath) } else { Join-Path $localRoot 'secrets\mariadb-integration.json' }
if (!$databaseConfig.StartsWith($localRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '数据库配置不在本工程内，拒绝读取。' }
foreach ($entry in @(
    @{path=(Join-Path $runtime 'integration-environment.json');keys=@('adminPassword')},
    @{path=(Join-Path $runtime 'integration-seed.json');keys=@('passwordA','passwordB')},
    @{path=(Join-Path $runtime 'config\token.json');keys=@('password','key')},
    @{path=$databaseConfig;keys=@('password')}
)) {
    if (Test-Path -LiteralPath $entry.path) {
        try { $config=Get-Content -LiteralPath $entry.path -Raw | ConvertFrom-Json }
        catch { throw '不能读取脱敏配置，拒绝输出日志。' }
        foreach ($key in $entry.keys) { if ($config.$key) { $values.Add([string]$config.$key) } }
    }
}
foreach ($name in @('stdout','stderr')) {
    $text = (Get-Content -LiteralPath (Join-Path $runtime "local\integration-logs\$name.log") -Tail $Tail) -join "`n"
    foreach ($value in $values) { $text=$text.Replace($value,'[REDACTED]') }
    $text = [regex]::Replace($text, '(?im)((?:Authorization|Proxy-Authorization|x-token|Cookie|Set-Cookie)\s*[:=]\s*)[^\r\n]*', '$1[REDACTED]')
    $text = [regex]::Replace($text, '(?i)("(?:password|token|key)"\s*:\s*")[^"\r\n]*(")', '$1[REDACTED]$2')
    $text = [regex]::Replace($text, '(?i)(\btoken\s*:\s*)[^,\r\n]*', '$1[REDACTED]')
    [pscustomobject]@{file="$name.log";sanitized=$true;tail=$text} | ConvertTo-Json
}
