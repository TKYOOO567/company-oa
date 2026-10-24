#requires -Version 7.0
<# Build the actual repository source in an ignored, documented snapshot; never starts a service. #>
[CmdletBinding()]
param(
    [ValidateSet('Server', 'Console', 'CoreTest', 'CoreBuild', 'Web', 'Assemble')][string] $Stage = 'Server',
    [string] $BuildRoot,
    [ValidatePattern('^[A-Za-z0-9_]+$')][string] $ConsoleTest
)
$ErrorActionPreference = 'Stop'
$executedScriptSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimeRoot = Join-Path $repoRoot '.local/runtime'
$sourceBuildRoot = Join-Path $runtimeRoot 'source-build'
$toolchains = Join-Path $runtimeRoot 'toolchains'
$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source commit.' }
if (-not $BuildRoot) {
    if ($Stage -ne 'Server') { throw 'Pass -BuildRoot for an existing source snapshot when selecting a later stage.' }
    $BuildRoot = Join-Path $sourceBuildRoot ('source-' + $commit.Substring(0, 12) + '-' + (Get-Date -Format 'yyyyMMddHHmmss'))
}
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
if (-not $BuildRoot.StartsWith([IO.Path]::GetFullPath($sourceBuildRoot).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BuildRoot must be a child of this repository .local/runtime/source-build directory.'
}
New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
$manifestFile = Join-Path $BuildRoot 'source-manifest.json'
if (-not (Test-Path -LiteralPath $manifestFile)) {
    if ($Stage -ne 'Server') { throw 'The source snapshot is not initialized.' }
    foreach ($directory in @('o2server', 'o2web')) {
        & robocopy.exe (Join-Path $repoRoot $directory) (Join-Path $BuildRoot $directory) /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
        if ($LASTEXITCODE -ge 8) { throw "Source snapshot copy failed: $directory" }
    }
    foreach ($file in @('package.json', 'gulpfile.js', 'build.xml', 'welcome', '.hintrc', 'LICENSE', 'upstream.json')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $BuildRoot $file)
    }
    # Git identifies the unchanged baseline without individually hashing tens of
    # thousands of assets. Modified/new inputs get actual snapshot SHA256 below.
    $trackedBlobs = @(& git -C $repoRoot ls-files --stage -- o2server o2web)
    $trackedBlobs | Set-Content -LiteralPath (Join-Path $BuildRoot 'tracked-source-blobs.txt') -Encoding utf8
    $changedPaths = @(& git -C $repoRoot diff --name-only HEAD -- o2server o2web)
    $changedPaths += @(& git -C $repoRoot ls-files --others --exclude-standard -- o2server o2web)
    $overrides = @($changedPaths | Sort-Object -Unique | ForEach-Object {
        $snapshotFile = Join-Path $BuildRoot $_
        if (-not (Test-Path -LiteralPath $snapshotFile -PathType Leaf)) { throw "Missing changed source input: $_" }
        $snapshotHash = (Get-FileHash -LiteralPath $snapshotFile -Algorithm SHA256).Hash
        if ($snapshotHash -ne (Get-FileHash -LiteralPath (Join-Path $repoRoot $_) -Algorithm SHA256).Hash) {
            throw "Source changed during snapshot copy: $_"
        }
        [ordered]@{ path = $_; bytes = (Get-Item -LiteralPath $snapshotFile).Length; sha256 = $snapshotHash }
    })
    $overrides | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $BuildRoot 'source-overrides.json') -Encoding utf8
    & git -C $repoRoot diff --binary HEAD -- o2server o2web | Set-Content -LiteralPath (Join-Path $BuildRoot 'source-working.patch') -Encoding utf8
    $changes = @(& git -C $repoRoot status --short -- o2server o2web package.json gulpfile.js build.xml)
    [ordered]@{
        repositoryCommit = $commit
        sourceState = 'working-tree-snapshot-including-recorded-uncommitted-platform-patches'
        changes = $changes
        trackedSourceFileCount = $trackedBlobs.Count
        trackedSourceBlobsSha256 = (Get-FileHash -LiteralPath (Join-Path $BuildRoot 'tracked-source-blobs.txt') -Algorithm SHA256).Hash
        overrideFileCount = $overrides.Count
        sourceOverridesSha256 = (Get-FileHash -LiteralPath (Join-Path $BuildRoot 'source-overrides.json') -Algorithm SHA256).Hash
        createdAt = [DateTimeOffset]::Now.ToString('o')
        buildRoot = $BuildRoot
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestFile -Encoding utf8
}
$java = Get-ChildItem -LiteralPath (Join-Path $toolchains 'o2-windows-java11') -Recurse -File -Filter javac.exe | Select-Object -First 1
$maven = Get-ChildItem -LiteralPath (Join-Path $toolchains 'apache-maven-3.9.11') -Recurse -File -Filter mvn.cmd | Select-Object -First 1
if (-not $java -or -not $maven) { throw 'Run Get-O2Dependencies.ps1 before building.' }
$buildJavaHome = Split-Path -Parent (Split-Path -Parent $java.FullName)
$mavenCache = Join-Path $sourceBuildRoot 'maven-repository'
$npmCache = Join-Path $sourceBuildRoot 'npm-cache'
$logs = Join-Path $BuildRoot 'build-logs'
New-Item -ItemType Directory -Path $logs, $mavenCache, $npmCache -Force | Out-Null
$oldJavaHome = $env:JAVA_HOME
$oldMavenOpts = $env:MAVEN_OPTS
$oldPath = $env:PATH
$oldNpmCache = $env:npm_config_cache
$oldNodeOptions = $env:NODE_OPTIONS
$env:JAVA_HOME = $buildJavaHome
$env:MAVEN_OPTS = '-Xmx1024m -Dfile.encoding=UTF-8'
$env:PATH = (Join-Path $buildJavaHome 'bin') + ';' + (Split-Path -Parent $maven.FullName) + ';' + $oldPath
$env:npm_config_cache = $npmCache
if ($Stage -eq 'Web') { $env:NODE_OPTIONS = '--max-old-space-size=1024' }
$log = Join-Path $logs ($Stage.ToLowerInvariant() + '-' + (Get-Date -Format 'yyyyMMddHHmmss') + '.log')
$startedAt = [DateTimeOffset]::Now.ToString('o')
Push-Location (Join-Path $BuildRoot 'o2server')
try {
    & $maven.FullName --version 2>&1 | Tee-Object -FilePath (Join-Path $logs 'tool-versions.log')
    if ($LASTEXITCODE -ne 0) { throw 'Maven toolchain validation failed.' }
    switch ($Stage) {
        'Server' {
            & $maven.FullName -B -ntp "-Dmaven.repo.local=$mavenCache" '-Dstyle.color=never' clean install 2>&1 | Tee-Object -FilePath $log
            if ($LASTEXITCODE -ne 0) { throw "Maven server build failed; see $log" }
        }
        'CoreTest' {
            & $maven.FullName -B -ntp "-Dmaven.repo.local=$mavenCache" '-Dstyle.color=never' -pl x_base_core_project '-Dtest=ExternalDataSourcesTest' '-DskipTests=false' test 2>&1 | Tee-Object -FilePath $log
            if ($LASTEXITCODE -ne 0) { throw "Core test failed; see $log" }
            $testReport = Join-Path $BuildRoot 'o2server/x_base_core_project/target/surefire-reports/TEST-com.x.base.core.project.config.ExternalDataSourcesTest.xml'
            if (-not (Test-Path -LiteralPath $testReport)) { throw 'No ExternalDataSourcesTest Surefire report was produced.' }
            [xml]$tests = Get-Content -LiteralPath $testReport -Raw
            if ([int]$tests.testsuite.tests -lt 1 -or [int]$tests.testsuite.failures -ne 0 -or [int]$tests.testsuite.errors -ne 0) {
                throw 'Core regression test did not execute successfully.'
            }
        }
        'CoreBuild' {
            & $maven.FullName -B -ntp "-Dmaven.repo.local=$mavenCache" '-Dstyle.color=never' -pl x_base_core_project '-Dtest=ExternalDataSourcesTest,CompanyOaMySQLDictionaryTest' '-DskipTests=false' install 2>&1 | Tee-Object -FilePath $log
            if ($LASTEXITCODE -ne 0) { throw "Shared core build/regression tests failed; see $log" }
            foreach ($suite in @(
                @{ name = 'com.x.base.core.project.config.ExternalDataSourcesTest'; count = 2 },
                @{ name = 'com.x.base.core.openjpa.jdbc.sql.CompanyOaMySQLDictionaryTest'; count = 4 }
            )) {
                $testReport = Join-Path $BuildRoot ("o2server/x_base_core_project/target/surefire-reports/TEST-" + $suite.name + '.xml')
                [xml]$tests = Get-Content -LiteralPath $testReport -Raw
                if ([int]$tests.testsuite.tests -ne $suite.count -or [int]$tests.testsuite.failures -ne 0 -or [int]$tests.testsuite.errors -ne 0 -or [int]$tests.testsuite.skipped -ne 0) {
                    throw "Core suite did not execute all expected tests: $($suite.name)"
                }
            }
        }
        'Console' {
            $testOptions = if ($ConsoleTest) { @('-DskipTests=false', "-Dtest=$ConsoleTest") } else { @() }
            & $maven.FullName -B -ntp "-Dmaven.repo.local=$mavenCache" '-Dstyle.color=never' -pl x_console @testOptions install 2>&1 | Tee-Object -FilePath $log
            if ($LASTEXITCODE -ne 0) { throw "Console rebuild failed; see $log" }
            if ($ConsoleTest) {
                $report = Get-ChildItem -LiteralPath (Join-Path $BuildRoot 'o2server/x_console/target/surefire-reports') -File -Filter "TEST-*$ConsoleTest.xml" | Select-Object -First 1
                if (-not $report) { throw 'The requested console regression test did not produce a report.' }
                [xml]$tests = Get-Content -LiteralPath $report.FullName -Raw
                if ([int]$tests.testsuite.tests -lt 1 -or [int]$tests.testsuite.failures -ne 0 -or [int]$tests.testsuite.errors -ne 0) {
                    throw 'Console regression tests did not execute successfully.'
                }
            }
        }
        'Web' {
            Set-Location $BuildRoot
            & npm.cmd install --no-audit --no-fund --cache $npmCache 2>&1 | Tee-Object -FilePath $log
            if ($LASTEXITCODE -ne 0) { throw "Npm install failed; see $log" }
            $guardSource = Join-Path $PSScriptRoot 'o2-build-guard.cjs'
            $guardCopy = Join-Path $logs 'o2-build-guard.cjs'
            Copy-Item -LiteralPath $guardSource -Destination $guardCopy -Force
            $env:NODE_OPTIONS += ' --require="' + $guardCopy.Replace('\', '/') + '"'
            # Calling the same Gulp task directly avoids npm run propagating
            # CLI-only npm 11 policy options into the task's nested npm installs.
            & node (Join-Path $BuildRoot 'node_modules/gulp-cli/bin/gulp.js') build_web 2>&1 | Tee-Object -FilePath $log -Append
            if ($LASTEXITCODE -ne 0) { throw "O2 Web build failed; see $log" }
            foreach ($asset in @(
                'o2_core/o2.min.js', 'x_desktop/work.html', 'x_desktop/js/work.min.js',
                'x_desktop/js/base_work.min.js', 'x_component_process_Work/Main.min.js',
                'x_component_process_Xform/Form.min.js'
            )) {
                $assetFile = Join-Path $BuildRoot ('target/o2server/servers/webServer/' + $asset)
                if (-not (Test-Path -LiteralPath $assetFile -PathType Leaf) -or (Get-Item -LiteralPath $assetFile).Length -eq 0) {
                    throw "Missing compiled native-form asset: $asset"
                }
            }
        }
        'Assemble' {
            $commons = Get-ChildItem -LiteralPath (Join-Path $toolchains 'o2-commons-9.3') -Directory -Recurse | Where-Object Name -eq 'commons' | Select-Object -First 1
            if (-not $commons) { throw 'Commons dependency archive has not been extracted.' }
            foreach ($pair in @(
                @{ source = $commons.FullName; destination = (Join-Path $BuildRoot 'o2server/commons') },
                @{ source = $buildJavaHome; destination = (Join-Path $BuildRoot 'o2server/jvm/windows_java11') }
            )) {
                & robocopy.exe $pair.source $pair.destination /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
                if ($LASTEXITCODE -ge 8) { throw 'Runtime dependency assembly failed.' }
            }
            Set-Location $BuildRoot
            & node (Join-Path $BuildRoot 'node_modules/gulp-cli/bin/gulp.js') deploy --e windows 2>&1 | Tee-Object -FilePath $log
            if ($LASTEXITCODE -ne 0) { throw "Runtime assembly failed; see $log" }
        }
    }
    [ordered]@{
        stage = $Stage; passed = $true; sourceManifest = $manifestFile; buildRoot = $BuildRoot
        startedAt = $startedAt; completedAt = [DateTimeOffset]::Now.ToString('o'); log = $log
        testsExecuted = ($Stage -in 'CoreTest', 'CoreBuild' -or ($Stage -eq 'Console' -and [bool]$ConsoleTest)); platformStarted = $false; databaseAccessed = $false
        buildScriptSha256 = $executedScriptSha256
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $BuildRoot ($Stage.ToLowerInvariant() + '-receipt.json')) -Encoding utf8
    Write-Output "STAGE_COMPLETE=$Stage"
    Write-Output "SOURCE_BUILD_ROOT=$BuildRoot"
} finally {
    Pop-Location
    $env:JAVA_HOME = $oldJavaHome
    $env:MAVEN_OPTS = $oldMavenOpts
    $env:PATH = $oldPath
    $env:npm_config_cache = $oldNpmCache
    $env:NODE_OPTIONS = $oldNodeOptions
}
