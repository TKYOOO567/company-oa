#requires -Version 7.0
<# Refresh selected shared/console source inputs and snapshot provenance; does not change assembled runtime. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $BuildRoot,
    [ValidateSet('x_console', 'x_base_core_project')][string] $Module = 'x_console'
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
$allowed = [IO.Path]::GetFullPath((Join-Path $repoRoot '.local/runtime/source-build')).TrimEnd('\') + '\'
if (-not $BuildRoot.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'BuildRoot is outside the source-build tree.' }
$manifestFile = Join-Path $BuildRoot 'source-manifest.json'
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$base = $manifest.repositoryCommit
$moduleInputs = @(& git -C $repoRoot diff --name-only $base -- "o2server/$Module")
$moduleInputs += @(& git -C $repoRoot ls-files --others --exclude-standard -- "o2server/$Module")
$moduleInputs = @($moduleInputs | Sort-Object -Unique)
foreach ($path in $moduleInputs) {
    $sourceFile = Join-Path $repoRoot $path
    $targetFile = Join-Path $BuildRoot $path
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Deleted input requires a fresh source snapshot: $path" }
    New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
}
$allChanges = @(& git -C $repoRoot diff --name-only $base -- o2server o2web)
$allChanges += @(& git -C $repoRoot ls-files --others --exclude-standard -- o2server o2web)
$overrides = @($allChanges | Sort-Object -Unique | ForEach-Object {
    $sourceFile = Join-Path $repoRoot $_
    $targetFile = Join-Path $BuildRoot $_
    if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) { throw "An unsynchronized input requires a fresh snapshot: $_" }
    $hash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash
    if ($hash -ne (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash) { throw "An input outside the selected module changed; do not mislabel the snapshot: $_" }
    [ordered]@{ path = $_; bytes = (Get-Item -LiteralPath $targetFile).Length; sha256 = $hash }
})
$overridesFile = Join-Path $BuildRoot 'source-overrides.json'
$overrides | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $overridesFile -Encoding utf8
& git -C $repoRoot diff --binary $base -- o2server o2web | Set-Content -LiteralPath (Join-Path $BuildRoot 'source-working.patch') -Encoding utf8
$manifest.changes = @(& git -C $repoRoot status --short -- o2server o2web)
$manifest.overrideFileCount = $overrides.Count
$manifest.sourceOverridesSha256 = (Get-FileHash -LiteralPath $overridesFile -Algorithm SHA256).Hash
$manifest | Add-Member -NotePropertyName updatedAt -NotePropertyValue ([DateTimeOffset]::Now.ToString('o')) -Force
$manifest | Add-Member -NotePropertyName repositoryHeadAtLastSync -NotePropertyValue ((& git -C $repoRoot rev-parse HEAD).Trim()) -Force
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestFile -Encoding utf8
[ordered]@{ module = $Module; syncedInputs = $moduleInputs; sourceManifest = $manifestFile; overrideFileCount = $overrides.Count } | ConvertTo-Json -Depth 4
