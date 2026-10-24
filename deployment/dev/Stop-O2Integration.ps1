[CmdletBinding()]
param([Parameter(Mandatory)][string]$RuntimeRoot)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = Join-Path $projectRoot '.local'
$runtime = (Resolve-Path -LiteralPath $RuntimeRoot).ProviderPath.TrimEnd('\')
if (!$runtime.StartsWith($localRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '只操作本工程的隔离平台。' }
$marker = Get-Content -LiteralPath (Join-Path $runtime 'local\integration-logs\process.json') -Raw | ConvertFrom-Json
$processId = [int]$marker.pid
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
if (!$processInfo) { [pscustomobject]@{ stopped=$true; alreadyExited=$true; pid=$processId } | ConvertTo-Json; return }
if ($marker.runtimeRoot -ne $runtime -or $processInfo.ExecutablePath -ne (Join-Path $marker.javaHome 'bin\java.exe') -or $processInfo.CommandLine.IndexOf($runtime, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw '运行进程归属不能核实，未发送停止指令。'
}
$swap = Join-Path $runtime 'command.swap'
$stream = [IO.File]::Open($swap, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite)
try {
    $locked = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try { $stream.Lock(0, 1); $locked = $true; break }
        catch [IO.IOException] { Start-Sleep -Milliseconds 100 }
    }
    if (!$locked) { throw '命令文件仍被占用，未写入或覆盖指令。' }
    try {
        if ($stream.Length -ne 0) { throw '控制台命令队列尚有内容，未覆盖。' }
        $bytes = [Text.Encoding]::UTF8.GetBytes('exit')
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Unlock(0, 1) }
} finally { $stream.Dispose() }
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if ($process -and !$process.WaitForExit(45000)) { throw '已发送正常退出命令，但进程尚未退出；未强制终止。' }
[pscustomobject]@{ stopped=$true; pid=$processId; method='O2OA console exit'; stoppedAt=[DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json
