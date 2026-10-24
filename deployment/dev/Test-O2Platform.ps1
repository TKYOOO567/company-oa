#requires -Version 7.0
<#
.SYNOPSIS
Read-only Windows preflight and optional loopback HTTP probes for O2OA.
.DESCRIPTION
Does not install, download, build, start or reconfigure O2OA. Inspect exits 0 when
the diagnostic completed; this does not mean O2OA is ready. Probe exits 2 unless
both the web document and the actual authentication-mode API are recognized.
#>
[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'Probe')]
    [string] $Mode = 'Inspect',
    [string] $RuntimeRoot,
    [uri] $WebBaseUri = 'http://127.0.0.1:80/',
    [uri] $ApplicationBaseUri = 'http://127.0.0.1:80/',
    [ValidateRange(1, 30)]
    [int] $TimeoutSeconds = 5
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $repoRoot '.local/runtime/o2server' }
$resolvedRuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)

function Invoke-BoundedNative {
    param([string] $FilePath, [string[]] $Arguments = @())
    $process = [Diagnostics.Process]::new()
    $process.StartInfo.FileName = $FilePath
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $process.StartInfo.ArgumentList.Add($argument) }
    try {
        if (-not $process.Start()) { throw 'Process did not start.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true)
            $process.WaitForExit()
            return @{ exitCode = $null; timedOut = $true; output = '' }
        }
        return @{
            exitCode = $process.ExitCode
            timedOut = $false
            output = ($stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()).Trim()
        }
    } finally { $process.Dispose() }
}

function Get-ToolPresence {
    param([string] $Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    return @{ found = ($null -ne $command); path = $(if ($command) { $command.Source } else { $null }) }
}

function Test-LocalBaseUri {
    param([uri] $Value)
    if (-not $Value.IsAbsoluteUri -or $Value.Scheme -notin @('http', 'https') -or
        $Value.DnsSafeHost -notin @('localhost', '127.0.0.1', '::1') -or
        $Value.UserInfo -or $Value.Query -or $Value.Fragment) {
        throw 'HTTP probes accept only explicit loopback HTTP(S) URLs without credentials, query or fragment.'
    }
}

function Test-O2Http {
    param([uri] $Uri, [ValidateSet('web', 'authentication-mode')][string] $Kind)
    $result = [ordered]@{ url = $Uri.AbsoluteUri; statusCode = $null; recognized = $false; error = $null }
    try {
        # No proxy, no redirection, no credential, and GET only. Response bodies are not logged.
        $response = Invoke-WebRequest -Uri $Uri -Method Get -NoProxy -MaximumRedirection 0 `
            -TimeoutSec $TimeoutSeconds -SkipHttpErrorCheck -ErrorAction Stop
        $result.statusCode = [int]$response.StatusCode
        if ($response.StatusCode -eq 200) {
            if ($Kind -eq 'web') {
                $result.recognized = ($response.Content -match '(?is)<(?:!doctype\s+html|html)' -and
                    $response.Content -match '(?i)(o2oa|MWF|o2_core|x_desktop)')
            } else {
                $payload = $response.Content | ConvertFrom-Json -ErrorAction Stop
                $dataFields = @($payload.data.PSObject.Properties.Name)
                $result.recognized = ($payload.type -eq 'success' -and
                    $dataFields -contains 'userPwdLogin' -and $dataFields -contains 'codeLogin')
            }
        }
    } catch {
        # Do not emit response content, request headers, credentials or stack traces.
        $result.error = $_.Exception.GetType().Name
    }
    return $result
}

$tools = [ordered]@{}
foreach ($name in @('java', 'javac', 'mvn', 'ant', 'node', 'npm', 'git', 'docker')) {
    $tools[$name] = Get-ToolPresence -Name $name
}
if ($tools.node.found) {
    $nodeVersion = Invoke-BoundedNative -FilePath $tools.node.path -Arguments @('--version')
    $tools.node.version = $nodeVersion.output
    $npmHome = Split-Path -Parent $tools.node.path
    $npmCli = Join-Path $npmHome 'node_modules/npm/bin/npm-cli.js'
    $npmPrefixScript = Join-Path $npmHome 'node_modules/npm/bin/npm-prefix.js'
    if (Test-Path -LiteralPath $npmPrefixScript -PathType Leaf) {
        $prefixResult = Invoke-BoundedNative -FilePath $tools.node.path -Arguments @($npmPrefixScript)
        if ($prefixResult.exitCode -eq 0 -and $prefixResult.output) {
            $prefixCli = Join-Path $prefixResult.output 'node_modules/npm/bin/npm-cli.js'
            if (Test-Path -LiteralPath $prefixCli -PathType Leaf) { $npmCli = $prefixCli }
        }
    }
    if (Test-Path -LiteralPath $npmCli -PathType Leaf) {
        $npmVersion = Invoke-BoundedNative -FilePath $tools.node.path -Arguments @($npmCli, '--version')
        $tools.npm.version = $npmVersion.output
    }
}
foreach ($javaTool in @('java', 'javac')) {
    if ($tools[$javaTool].found) {
        $versionResult = Invoke-BoundedNative -FilePath $tools[$javaTool].path -Arguments @('-version')
        $tools[$javaTool].versionOutput = $versionResult.output
    }
}
$dockerEngine = [ordered]@{ checked = $false; available = $false; timedOut = $false }
if ($tools.docker.found) {
    $dockerResult = Invoke-BoundedNative -FilePath $tools.docker.path -Arguments @('version', '--format', '{{json .Server}}')
    $dockerEngine.checked = $true
    $dockerEngine.available = ($dockerResult.exitCode -eq 0 -and $dockerResult.output -ne 'null')
    $dockerEngine.timedOut = $dockerResult.timedOut
}

$memory = [ordered]@{ totalMiB = $null; freeMiB = $null; defaultHeapMiB = 4096; freeExceedsDefaultHeap = $false }
try {
    $os = Get-CimInstance Win32_OperatingSystem
    $memory.totalMiB = [math]::Round($os.TotalVisibleMemorySize / 1024)
    $memory.freeMiB = [math]::Round($os.FreePhysicalMemory / 1024)
    $memory.freeExceedsDefaultHeap = ($memory.freeMiB -gt $memory.defaultHeapMiB)
} catch { }
$freeDiskMiB = $null
try {
    $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($repoRoot).TrimEnd('\', ':'))
    $freeDiskMiB = [math]::Round($drive.Free / 1MB)
} catch { }

$runtimeChecks = [ordered]@{}
foreach ($relativePath in @(
    'console.jar',
    'jvm/windows_java11/bin/java.exe',
    'commons/module_java11/compiler.jar',
    'commons/module_java11/compiler-management.jar',
    'store/x_program_center.war',
    'store/x_organization_assemble_authentication.war',
    'store/x_processplatform_assemble_surface.war',
    'store/x_processplatform_assemble_designer.war',
    'servers/webServer',
    'version.o2'
)) {
    $runtimeChecks[$relativePath] = Test-Path -LiteralPath (Join-Path $resolvedRuntimeRoot $relativePath)
}
$missingRuntimeParts = @($runtimeChecks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object Key)
$sourceRoot = Join-Path $repoRoot 'o2server'
[xml]$pom = Get-Content -LiteralPath (Join-Path $sourceRoot 'pom.xml') -Raw
$sourceArtifacts = @(
    Get-ChildItem -LiteralPath $sourceRoot -File -Filter '*.jar'
    Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'store') -File | Where-Object { $_.Extension -in @('.war', '.jar') }
    Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'store/jars') -File -Filter '*.jar'
)
$sourceBuildToolsPresent = $tools.java.found -and $tools.javac.found -and $tools.mvn.found -and $tools.node.found -and $tools.npm.found
$httpChecks = @()
if ($Mode -eq 'Probe') {
    Test-LocalBaseUri -Value $WebBaseUri
    Test-LocalBaseUri -Value $ApplicationBaseUri
    $webUri = [uri]($WebBaseUri.AbsoluteUri.TrimEnd('/') + '/')
    $modeUri = [uri]($ApplicationBaseUri.AbsoluteUri.TrimEnd('/') + '/x_organization_assemble_authentication/jaxrs/authentication/mode')
    $httpChecks = @((Test-O2Http -Uri $webUri -Kind web), (Test-O2Http -Uri $modeUri -Kind authentication-mode))
}
$httpSmokePassed = $Mode -eq 'Probe' -and @($httpChecks | Where-Object { -not $_.recognized }).Count -eq 0
$report = [ordered]@{
    recordedAt = [DateTimeOffset]::Now.ToString('o')
    mode = $Mode
    tools = $tools
    dockerEngine = $dockerEngine
    memory = $memory
    freeDiskMiB = $freeDiskMiB
    source = @{
        moduleCount = @($pom.project.modules.module).Count
        compilerTarget = $pom.project.properties.'maven.compiler.target'
        serverArtifactsFound = $sourceArtifacts.Count
        requiredBuildToolsPresent = $sourceBuildToolsPresent
        buildExecuted = $false
    }
    runtime = @{
        root = $resolvedRuntimeRoot
        structuralMinimumPresent = ($missingRuntimeParts.Count -eq 0)
        missingMinimumParts = $missingRuntimeParts
        notice = 'Presence is only a partial structural check, not dependency completeness or a launch guarantee.'
    }
    httpChecks = $httpChecks
    httpSmokePassed = $httpSmokePassed
    platformStartedByScript = $false
    productionReady = $false
    businessAcceptancePassed = $false
}
$report | ConvertTo-Json -Depth 10
if ($Mode -eq 'Probe' -and -not $httpSmokePassed) { exit 2 }
exit 0
