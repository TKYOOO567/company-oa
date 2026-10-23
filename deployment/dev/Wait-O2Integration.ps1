[CmdletBinding()]
param([Parameter(Mandatory)][string]$RuntimeRoot, [ValidateRange(1,50)][int]$WaitSeconds = 45)
$ErrorActionPreference = 'Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot=Join-Path $projectRoot '.local'
$runtime=[IO.Path]::GetFullPath($RuntimeRoot)
if(!$runtime.StartsWith($localRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '仅检查本项目隔离运行目录。'}
$environment=Get-Content (Join-Path $runtime 'integration-environment.json') -Raw | ConvertFrom-Json
$marker=Get-Content (Join-Path $runtime 'local\integration-logs\process.json') -Raw | ConvertFrom-Json
if($marker.runtimeRoot -ne $runtime -or $environment.host -ne '127.0.0.1'){throw '环境归属不能确认。'}
$processId=[int]$marker.pid
$ports=@($environment.applicationPort,$environment.centerPort,$environment.webPort)
$deadline=[DateTimeOffset]::UtcNow.AddSeconds($WaitSeconds)
do {
    if(!(Get-Process -Id $processId -ErrorAction SilentlyContinue)){throw 'Java 进程已退出。'}
    $listeners=@(Get-NetTCPConnection -State Listen -OwningProcess $processId -ErrorAction SilentlyContinue)
    if(@($listeners | Where-Object LocalAddress -ne '127.0.0.1').Count){throw '发现非回环监听，停止就绪判定。'}
    if($listeners.Count -eq 3 -and @($listeners | Where-Object LocalPort -notin $ports).Count -eq 0){
        $startup=Get-Content -LiteralPath (Join-Path $runtime 'local\integration-logs\stdout.log') -Raw
        if($startup.Contains('application server start completed.') -and $startup.Contains('web server start completed.')){
            try {
                $web=Invoke-WebRequest -Uri "http://127.0.0.1:$($environment.webPort)/" -NoProxy -TimeoutSec 2 -MaximumRedirection 0 -SkipHttpErrorCheck
                $auth=Invoke-RestMethod -Uri "http://127.0.0.1:$($environment.applicationPort)/x_organization_assemble_authentication/jaxrs/authentication/mode" -NoProxy -TimeoutSec 2
                if($web.StatusCode -eq 200 -and $web.Content -match 'x_desktop' -and $auth.type -eq 'success'){
                    $receipt=@{platformHttpReady=$true;pid=$processId;ports=$ports;host='127.0.0.1';businessAcceptancePassed=$false;checkedAt=[DateTimeOffset]::UtcNow.ToString('o')}
                    $receipt | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $runtime 'readiness-verification.json') -Encoding utf8
                    $receipt | ConvertTo-Json -Depth 4
                    return
                }
            } catch { # A partial startup response is not readiness.
            }
        }
    }
    Start-Sleep -Milliseconds 500
}while([DateTimeOffset]::UtcNow -lt $deadline)
throw '平台尚未完整就绪；未把最早可达的认证端口视为整个平台成功。'
