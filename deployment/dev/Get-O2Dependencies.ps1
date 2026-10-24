#requires -Version 7.0
<# Downloads portable build/runtime inputs into this repository's ignored .local tree. #>
[CmdletBinding()]
param([ValidateSet('Maven', 'Jvm', 'Commons', 'All')][string] $Component = 'All')
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimeRoot = Join-Path $repoRoot '.local/runtime'
$downloadRoot = Join-Path $runtimeRoot 'downloads'
$toolchainRoot = Join-Path $runtimeRoot 'toolchains'
New-Item -ItemType Directory -Path $downloadRoot, $toolchainRoot -Force | Out-Null
$components = @{
    Maven = @{
        name = 'apache-maven-3.9.11-bin.zip'
        uri = 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip'
        checksumUri = 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip.sha512'
        destination = 'apache-maven-3.9.11'
    }
    Jvm = @{
        name = 'o2-windows-java11-master.tar.gz'
        uri = 'https://g.o2oa.net/o2oa/evn-o2server-jvm/-/archive/master/evn-o2server-jvm-master.tar.gz?path=jvm/windows_java11'
        checksumUri = $null
        destination = 'o2-windows-java11'
    }
    Commons = @{
        name = 'o2-commons-9.3.tar.gz'
        uri = 'https://g.o2oa.net/o2oa/evn-o2server-commons/-/archive/9.3/evn-o2server-commons-9.3.tar.gz?path=commons'
        checksumUri = $null
        destination = 'o2-commons-9.3'
    }
}
$selected = if ($Component -eq 'All') { @('Maven', 'Jvm', 'Commons') } else { @($Component) }
foreach ($key in $selected) {
    $spec = $components[$key]
    $archive = Join-Path $downloadRoot $spec.name
    $metadataFile = $archive + '.json'
    $old = if (Test-Path -LiteralPath $metadataFile) { Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json } else { $null }
    $cached = $old -and $old.uri -eq $spec.uri -and (Test-Path -LiteralPath $archive) -and
        (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -eq $old.sha256
    if (-not $cached) {
        if (Test-Path -LiteralPath $archive) { throw "Unverified pre-existing archive must be reviewed: $archive" }
        $partial = $archive + '.partial'
        $curlArgs = @('--fail', '--location', '--silent', '--show-error', '--retry', '3', '--connect-timeout', '30', '--max-time', '1800', '--output', $partial)
        if (Test-Path -LiteralPath $partial) { $curlArgs += @('--continue-at', '-') }
        $curlArgs += $spec.uri
        Write-Output "Downloading $key to ignored runtime cache."
        & curl.exe @curlArgs
        if ($LASTEXITCODE -ne 0) { throw "Download failed for $key (curl exit $LASTEXITCODE); partial file retained." }
        if ((Get-Item -LiteralPath $partial).Length -eq 0) { throw "Empty archive: $key" }
        Move-Item -LiteralPath $partial -Destination $archive
    }
    $sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    $sha512 = (Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash
    $publisherChecksumVerified = $false
    if ($spec.checksumUri) {
        $checksumFile = $archive + '.sha512'
        if (-not (Test-Path -LiteralPath $checksumFile)) {
            & curl.exe --fail --location --silent --show-error --connect-timeout 20 --max-time 120 --output $checksumFile $spec.checksumUri
            if ($LASTEXITCODE -ne 0) { throw 'Publisher checksum download failed.' }
        }
        $expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split '\s+')[0]
        if ($expected -notmatch '^[a-fA-F0-9]{128}$' -or $expected -ne $sha512) { throw "Publisher SHA512 mismatch: $key" }
        $publisherChecksumVerified = $true
    }
    $destination = Join-Path $toolchainRoot $spec.destination
    $markerFile = Join-Path $destination 'extraction.json'
    $marker = if (Test-Path -LiteralPath $markerFile) { Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json } else { $null }
    if (-not $marker -or $marker.sha256 -ne $sha256) {
        if ((Test-Path -LiteralPath $destination) -and @(Get-ChildItem -LiteralPath $destination -Force).Count) {
            throw "Nonempty unverified extraction directory: $destination"
        }
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        $entries = @(& tar.exe -tf $archive)
        if ($LASTEXITCODE -ne 0 -or -not $entries.Count) { throw 'Archive listing failed.' }
        foreach ($entry in $entries) {
            $normalized = $entry.Replace('\', '/')
            if ($normalized -match '(^/|^[a-zA-Z]:|(^|/)\.\.(/|$))') { throw "Unsafe archive path: $entry" }
        }
        & tar.exe -xf $archive -C $destination
        if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed: $key" }
        @{ sha256 = $sha256; extractedAt = [DateTimeOffset]::Now.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $markerFile -Encoding utf8
    }
    $record = [ordered]@{
        component = $key; uri = $spec.uri; bytes = (Get-Item -LiteralPath $archive).Length
        sha256 = $sha256; sha512 = $sha512; publisherChecksumVerified = $publisherChecksumVerified
        extractionRoot = $destination; recordedAt = [DateTimeOffset]::Now.ToString('o')
        note = 'O2 dependency archives are not a precompiled substitute for the repository source build. JVM master is pinned here by downloaded content hash.'
    }
    $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metadataFile -Encoding utf8
    $record | ConvertTo-Json -Depth 4
}
