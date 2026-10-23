#requires -Version 7.0
<# Verify assembled source-build artifacts without starting O2OA or accessing a database. #>
[CmdletBinding()]
param([Parameter(Mandatory)][string] $BuildRoot, [string] $RuntimeRoot)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
$allowed = [IO.Path]::GetFullPath((Join-Path $repoRoot '.local/runtime/source-build')).TrimEnd('\') + '\'
if (-not $BuildRoot.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BuildRoot must be inside this repository ignored source-build directory.'
}
if (!$RuntimeRoot) { $RuntimeRoot = Join-Path $BuildRoot 'target/o2server' }
$RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$localRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.local')).TrimEnd('\') + '\'
if (!$RuntimeRoot.StartsWith($localRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'RuntimeRoot must be inside this project .local directory.' }
$manifestFile = Join-Path $BuildRoot 'source-manifest.json'
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$overridesFile = Join-Path $BuildRoot 'source-overrides.json'
if ((Get-FileHash -LiteralPath $overridesFile -Algorithm SHA256).Hash -ne $manifest.sourceOverridesSha256) {
    throw 'Source override manifest hash is inconsistent.'
}
$overrides = @(Get-Content -LiteralPath $overridesFile -Raw | ConvertFrom-Json)
$hasIndexPatch = @($overrides | Where-Object { $_.path -like '*/CompanyOaMySQLDictionary.java' }).Count -gt 0
foreach ($inputFile in $overrides) {
    if ((Get-FileHash -LiteralPath (Join-Path $BuildRoot $inputFile.path) -Algorithm SHA256).Hash -ne $inputFile.sha256) {
        throw "Source snapshot no longer matches recorded input: $($inputFile.path)"
    }
}
$stageNames = @('server', 'coretest', 'web', 'console', 'assemble')
if ($hasIndexPatch) { $stageNames += 'corebuild' }
$stages = $stageNames | ForEach-Object {
    $receipt = Get-Content -LiteralPath (Join-Path $BuildRoot "$_-receipt.json") -Raw | ConvertFrom-Json
    if (-not $receipt.passed) { throw "Build stage is not successful: $_" }
    [ordered]@{ stage = $receipt.stage; completedAt = $receipt.completedAt; log = $receipt.log; testsExecuted = $receipt.testsExecuted }
}
$suites = @(
    @{ path = 'o2server/x_base_core_project/target/surefire-reports/TEST-com.x.base.core.project.config.ExternalDataSourcesTest.xml'; count = 2 },
    @{ path = 'o2server/x_console/target/surefire-reports/TEST-com.x.server.console.ResourceFactoryDataSourcesTest.xml'; count = 3 }
)
if ($hasIndexPatch) {
    $suites += @{ path = 'o2server/x_base_core_project/target/surefire-reports/TEST-com.x.base.core.openjpa.jdbc.sql.CompanyOaMySQLDictionaryTest.xml'; count = 4 }
}
$tests = $suites | ForEach-Object {
    [xml]$report = Get-Content -LiteralPath (Join-Path $BuildRoot $_.path) -Raw
    $suite = $report.testsuite
    if ([int]$suite.tests -ne $_.count -or [int]$suite.failures -ne 0 -or [int]$suite.errors -ne 0 -or [int]$suite.skipped -ne 0) {
        throw "Regression suite did not complete all expected tests: $($_.path)"
    }
    [ordered]@{ name = $suite.name; tests = [int]$suite.tests; failures = [int]$suite.failures; errors = [int]$suite.errors; skipped = [int]$suite.skipped }
}
$modules = @(Get-ChildItem -LiteralPath (Join-Path $BuildRoot 'o2server/store') -Recurse -File | Where-Object Extension -in '.war', '.jar')
if (@($modules | Where-Object Extension -eq '.war').Count -ne 29 -or @($modules | Where-Object Extension -eq '.jar').Count -ne 25) {
    throw 'Expected the baseline 29 WAR and 25 shared JAR source-built modules.'
}
$artifacts = @('console.jar') + @($modules | ForEach-Object { [IO.Path]::GetRelativePath((Join-Path $BuildRoot 'o2server'), $_.FullName) })
$artifactEvidence = @($artifacts | ForEach-Object {
    $source = Join-Path $BuildRoot ('o2server/' + $_)
    $assembled = Join-Path $runtimeRoot $_
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $assembled -Algorithm SHA256).Hash -ne $sourceHash) {
        throw "Assembled artifact differs from source build output: $_"
    }
    [ordered]@{ path = $_; bytes = (Get-Item -LiteralPath $assembled).Length; sha256 = $sourceHash }
})
$assets = @(
    'servers/webServer/o2_core/o2.min.js',
    'servers/webServer/x_desktop/work.html',
    'servers/webServer/x_desktop/js/work.min.js',
    'servers/webServer/x_desktop/js/base_work.min.js',
    'servers/webServer/x_component_process_Work/Main.min.js',
    'servers/webServer/x_component_process_Xform/Form.min.js',
    'jvm/windows_java11/bin/java.exe',
    'commons/ext_java11/mysql-connector-j-8.4.0.jar'
) | ForEach-Object {
    $file = Get-Item -LiteralPath (Join-Path $runtimeRoot $_)
    if ($file.Length -eq 0) { throw "Required runtime file is empty: $_" }
    [ordered]@{ path = $_; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
}
$evidenceFile = Join-Path $BuildRoot 'runtime-artifacts.json'
[ordered]@{
    checkedAt = [DateTimeOffset]::Now.ToString('o')
    verification = 'artifact-and-regression-evidence-only'
    repositoryCommit = $manifest.repositoryCommit
    sourceManifestSha256 = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash
    sourceOverrideCount = $overrides.Count
    runtimeRoot = $runtimeRoot
    stages = @($stages)
    regressionTests = @($tests)
    sourceBuiltArtifacts = $artifactEvidence
    requiredRuntimeFiles = @($assets)
    platformStartedByVerifier = $false
    databaseAccessedByVerifier = $false
} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $evidenceFile -Encoding utf8
Write-Output "ARTIFACT_VERIFICATION_PASSED=$evidenceFile"
