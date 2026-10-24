function Invoke-LocalMariaDbSql {
    param([Parameter(Mandatory)]$Connection, [Parameter(Mandatory)][string]$Sql,
        [Parameter(Mandatory)][string]$SecretRoot,
        [string]$ClientPath = 'C:\Program Files\MariaDB 12.3\bin\mariadb.exe')
    if ($Connection.host -ne '127.0.0.1') { throw 'SQL 工具只允许本机测试连接。' }
    function Quote-Ini([string]$Value) {
        return '"' + $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n') + '"'
    }
    $optionFile = Join-Path $SecretRoot ('client-' + [Guid]::NewGuid().ToString('N') + '.cnf')
    $content = "[client]`nprotocol=TCP`nhost=127.0.0.1`nport=$($Connection.port)`nuser=$(Quote-Ini $Connection.user)`npassword=$(Quote-Ini $Connection.password)`n"
    [IO.File]::WriteAllText($optionFile, $content, [Text.UTF8Encoding]::new($false))
    try {
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $ClientPath
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardInput = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
        $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
        $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
        $start.ArgumentList.Add("--defaults-extra-file=$optionFile")
        $start.ArgumentList.Add('--batch')
        $start.ArgumentList.Add('--skip-column-names')
        $start.ArgumentList.Add('--default-character-set=utf8mb4')
        $process = [Diagnostics.Process]::Start($start)
        $outTask = $process.StandardOutput.ReadToEndAsync()
        $errTask = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.WriteLine($Sql)
        $process.StandardInput.Close()
        if (!$process.WaitForExit(30000)) { $process.Kill(); throw '数据库命令超时。' }
        return @{ Code = $process.ExitCode; Output = $outTask.GetAwaiter().GetResult(); Error = $errTask.GetAwaiter().GetResult() }
    } finally {
        [IO.File]::WriteAllText($optionFile, '', [Text.UTF8Encoding]::new($false))
    }
}
Export-ModuleMember -Function Invoke-LocalMariaDbSql
