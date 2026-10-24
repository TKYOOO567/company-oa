[CmdletBinding()]
param([Parameter(Mandatory)][string]$RuntimeRoot)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = Join-Path $projectRoot '.local'
$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
if (!$runtime.StartsWith($localRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw '只允许本工程测试运行目录。' }
$environment = Get-Content (Join-Path $runtime 'integration-environment.json') -Raw | ConvertFrom-Json
$config = [IO.Path]::GetFullPath($environment.databaseConfigPath)
if (!$config.StartsWith($localRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw '测试库配置必须位于 .local 内。' }
$db = Get-Content $config -Raw | ConvertFrom-Json
if ($db.status -ne 'ready' -or $db.database -ne $environment.database -or $db.database -notmatch '^companyoait\d{8}[a-f0-9]{8}$') { throw '不是已验证的独立测试库。' }
Import-Module (Join-Path $PSScriptRoot 'MariaDb.Client.psm1') -Force
$metadata = @"
USE ``$($db.database)``;
SELECT 'engine', ENGINE FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='qry_item';
SELECT COLUMN_NAME, CONCAT(CHARACTER_MAXIMUM_LENGTH,':',CHARACTER_SET_NAME) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='qry_item' AND COLUMN_NAME IN ('xbundle','xstringShortValue');
SELECT CONCAT('index',SEQ_IN_INDEX), CONCAT(COLUMN_NAME,':',IFNULL(SUB_PART,0)) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='qry_item' AND INDEX_NAME='QRY_ITEM_stringShortValue' ORDER BY SEQ_IN_INDEX;
"@
function Read-Values($Result) {
    if ($Result.Code -ne 0) {
        $Result.Error | Set-Content (Join-Path $runtime 'mariadb-index-error.log') -Encoding utf8
        $code=[regex]::Match($Result.Error,'ERROR (\d+)').Groups[1].Value
        throw "索引验证 SQL 失败：MariaDB $code，诊断留在私有运行目录。"
    }
    $values=@{}
    foreach ($line in ($Result.Output.Trim() -split "`r?`n")) { $parts=$line -split "`t",2; if($parts.Count -ne 2){throw '验证结果格式错误。'}; $values[$parts[0]]=$parts[1] }
    return $values
}
$values=Read-Values (Invoke-LocalMariaDbSql -Connection $db -Sql $metadata -SecretRoot (Join-Path $localRoot 'secrets'))
if ($values.engine -ne 'InnoDB' -or $values.xbundle -ne '255:utf8mb4' -or $values.xstringShortValue -ne '255:utf8mb4' -or $values.index1 -ne 'xbundle:128' -or $values.index2 -ne 'xstringShortValue:128') { throw '列长度、字符集、引擎或索引前缀不符合实际修复。' }
for($position=3;$position -le 6;$position++) { if($values["index$position"] -ne "xpath$($position-3):0") { throw '路径列索引不应截短。' } }
$idA=[Guid]::NewGuid().ToString(); $idB=[Guid]::NewGuid().ToString()
$bundle=('b'*128); $short=('v'*128)
$sql=@"
USE ``$($db.database)``;
START TRANSACTION;
INSERT INTO QRY_ITEM (xid,xbundle,xstringShortValue,xpath0,xpath1,xpath2,xpath3) VALUES
('$idA','${bundle}测试A','${short}中文😀A','','','',''),
('$idB','${bundle}测试B','${short}中文😀B','','','','');
SELECT 'collidingPrefixes', COUNT(*) FROM QRY_ITEM WHERE xid IN ('$idA','$idB') AND LEFT(xbundle,128)='$bundle' AND LEFT(xstringShortValue,128)='$short';
SELECT 'fullA',COUNT(*) FROM QRY_ITEM WHERE xid IN ('$idA','$idB') AND xbundle='${bundle}测试A' AND xstringShortValue='${short}中文😀A';
SELECT 'fullB',COUNT(*) FROM QRY_ITEM WHERE xid IN ('$idA','$idB') AND xbundle='${bundle}测试B' AND xstringShortValue='${short}中文😀B';
SELECT 'fourByteCharacters',COUNT(*) FROM QRY_ITEM WHERE xid IN ('$idA','$idB') AND LOCATE(CONVERT(0xF09F9880 USING utf8mb4),xstringShortValue)>0;
ROLLBACK;
SELECT 'remainingProbeRows',COUNT(*) FROM QRY_ITEM WHERE xid IN ('$idA','$idB');
"@
$probe=Read-Values (Invoke-LocalMariaDbSql -Connection $db -Sql $sql -SecretRoot (Join-Path $localRoot 'secrets'))
if ($probe.collidingPrefixes -ne '2' -or $probe.fullA -ne '1' -or $probe.fullB -ne '1' -or $probe.fourByteCharacters -ne '2' -or $probe.remainingProbeRows -ne '0') { throw '完整值比较、四字节字符或事务回滚未通过。' }
$receipt=@{passed=$true;database=$db.database;metadata=$values;checks=$probe;checkedAt=[DateTimeOffset]::UtcNow.ToString('o')}
$receipt | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $runtime 'mariadb-index-verification.json') -Encoding utf8
$receipt | ConvertTo-Json -Depth 6
