[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RuntimeRoot,
    [Parameter(Mandatory)][string]$JavaHome,
    [ValidateRange(768,4096)][int]$HeapMiB = 1280
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.local'))
$runtime = (Resolve-Path -LiteralPath $RuntimeRoot).ProviderPath.TrimEnd('\')
if (!$runtime.StartsWith($localRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '必须启动本项目 .local 中的隔离平台。' }
$environment = Get-Content -LiteralPath (Join-Path $runtime 'integration-environment.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$node = Get-Content -LiteralPath (Join-Path $runtime 'config\node_127.0.0.1.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($environment.runtimeRoot -ne $runtime -or $node.nodeAgentEnable -ne $false -or $node.data.enable -ne $false -or $node.storage.enable -ne $false) {
    throw '隔离节点配置不符合 HTTP-only、本机外部测试库的约束。'
}
$ports = @($environment.webPort, $environment.applicationPort, $environment.centerPort)
if (@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in $ports).Count) { throw '测试端口已占用，不会停止或覆盖其他服务。' }
$java = Join-Path $JavaHome 'bin\java.exe'
if (!(Test-Path -LiteralPath $java)) { throw 'JavaHome 中没有 java.exe。' }
$logs = Join-Path $runtime 'local\integration-logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$moduleRoot = Join-Path $runtime 'commons\module_java11'
$arguments = @(
    '-javaagent:console.jar', '-server', '-Xms256m', "-Xmx${HeapMiB}m", '-XX:ActiveProcessorCount=4', '-Duser.timezone=Asia/Shanghai', '-Dfile.encoding=UTF-8'
    '-Do2oa.bindHost=127.0.0.1', '-XX:+UnlockExperimentalVMOptions', '-XX:+EnableJVMCI'
    "--module-path=$moduleRoot", "--upgrade-module-path=$moduleRoot\compiler.jar;$moduleRoot\compiler-management.jar", '-jar', 'console.jar'
)
# Start-Process has string-based argument quoting on Windows. Quote only the
# known module path values; credentials are read from private platform files.
$quoted = $arguments | ForEach-Object { if ($_ -match '[\s;]') { '"' + $_ + '"' } else { $_ } }
$process = Start-Process -FilePath $java -ArgumentList $quoted -WorkingDirectory $runtime -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'stdout.log') -RedirectStandardError (Join-Path $logs 'stderr.log') -PassThru
@{ pid = $process.Id; runtimeRoot = $runtime; javaHome = $JavaHome; heapMiB = $HeapMiB; startedAt = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'process.json') -Encoding utf8
[pscustomobject]@{ pid = $process.Id; status = 'starting'; runtimeRoot = $runtime; logs = $logs } | ConvertTo-Json
