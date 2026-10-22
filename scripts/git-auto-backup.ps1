param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot '../.local-recovery/git-auto-backup/config.json'),
    [switch]$ValidateOnly,
    [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$stateDir = Split-Path -Parent $ConfigPath
$logPath = Join-Path $stateDir 'backup.log'
$lock = $null
$indexPath = Join-Path $stateDir ('index-' + [guid]::NewGuid().ToString('N'))

function Write-BackupLog([string]$Message) {
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 2MB) {
        Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force
    }
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    Write-Output $line
}

function Invoke-Git {
    param([string[]]$GitArguments, [string]$InputText, [switch]$SnapshotIndex, [int[]]$AllowedCodes = @(0))
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $config.gitPath
    # Windows command-line quoting, including quotes and trailing backslashes.
    $quoted = foreach ($argument in $GitArguments) {
        '"' + [regex]::Replace([regex]::Replace($argument, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
    }
    $info.Arguments = $quoted -join ' '
    $info.WorkingDirectory = $config.root
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $info.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    # Do not inherit an index/worktree override from another Git operation.
    foreach ($name in @('GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR')) {
        $info.EnvironmentVariables.Remove($name)
    }
    foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'GIT_HTTP_PROXY', 'GIT_HTTPS_PROXY', 'GCM_HTTP_PROXY')) {
        $info.EnvironmentVariables.Remove($name)
    }
    if ($SnapshotIndex) { $info.EnvironmentVariables['GIT_INDEX_FILE'] = $indexPath }
    $info.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    $info.EnvironmentVariables['GCM_INTERACTIVE'] = 'Never'
    $info.EnvironmentVariables['GIT_AUTHOR_NAME'] = 'Git Auto Backup'
    $info.EnvironmentVariables['GIT_AUTHOR_EMAIL'] = 'auto-backup@localhost'
    $info.EnvironmentVariables['GIT_COMMITTER_NAME'] = 'Git Auto Backup'
    $info.EnvironmentVariables['GIT_COMMITTER_EMAIL'] = 'auto-backup@localhost'
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if ($InputText) {
            $inputBytes = [System.Text.Encoding]::UTF8.GetBytes($InputText)
            $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
            $process.StandardInput.BaseStream.Flush()
        }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(120000)) {
            $process.Kill()
            throw 'Git command timed out; next scheduled run will retry.'
        }
        $output = $stdout.GetAwaiter().GetResult()
        $errorOutput = $stderr.GetAwaiter().GetResult()
        if ($AllowedCodes -notcontains $process.ExitCode) {
            # Never log credential helper output or source contents.
            throw ('Git {0} failed (exit {1}); check connectivity and Git credentials.' -f $GitArguments[0], $process.ExitCode)
        }
        return $output.TrimEnd("`r", "`n")
    } finally { $process.Dispose() }
}

function Assert-PrivateDestination {
    if ($config.remoteUrl -ne 'https://github.com/HannJia/novel-ai-studio-dev.git') {
        throw 'Unexpected backup destination; refusing upload.'
    }
    $url = Invoke-Git -GitArguments @('remote', 'get-url', '--push', '--all', 'origin')
    if ($url -ne $config.remoteUrl) { throw 'Origin push destination changed; refusing upload.' }
    $credential = Invoke-Git -GitArguments @('-c', 'http.proxy=', '-c', 'credential.interactive=false', 'credential', 'fill') -InputText "protocol=https`nhost=github.com`nusername=HannJia`n`n"
    $fields = @{}
    foreach ($line in $credential.Split("`n")) {
        $pair = $line.TrimEnd("`r") -split '=', 2
        if ($pair.Count -eq 2) { $fields[$pair[0]] = $pair[1] }
    }
    if (-not $fields.password) { throw 'GitHub login required; local snapshot retained.' }
    try {
        $request = [Net.HttpWebRequest]::Create('https://api.github.com/repos/HannJia/novel-ai-studio-dev')
        $request.Proxy = $null
        $request.Timeout = 30000
        $request.UserAgent = 'NovelAIStudio-GitAutoBackup'
        $request.Accept = 'application/vnd.github+json'
        $request.Headers['Authorization'] = 'Bearer ' + $fields.password
        $response = $request.GetResponse()
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        try { $repository = $reader.ReadToEnd() | ConvertFrom-Json }
        finally { $reader.Dispose(); $response.Dispose() }
        if (-not $repository.private -or $repository.full_name -ne 'HannJia/novel-ai-studio-dev') {
            throw 'Backup repository is not the expected private repository.'
        }
    } catch { throw 'Could not verify private repository access; local snapshot retained and upload stopped.' }
    finally { $credential = $null; $fields.Clear() }
}

try {
    try { $lock = [System.IO.File]::Open((Join-Path $stateDir 'running.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [System.IO.IOException] { Write-Output 'Another backup is running.'; exit 0 }
    $root = Invoke-Git -GitArguments @('rev-parse', '--show-toplevel')
    if ([IO.Path]::GetFullPath($root) -ne [IO.Path]::GetFullPath($config.root)) { throw 'Repository root changed.' }
    $null = Invoke-Git -GitArguments @('check-ref-format', ('refs/heads/' + $config.branch))
    if (Test-Path -LiteralPath (Join-Path $config.root '.git/index.lock')) { throw 'Git index is busy; next run will retry.' }
    $tracked = Invoke-Git -GitArguments @('ls-files', '--cached', '-z')
    $paths = @($tracked.Split([char]0) | Where-Object { $_ })
    if ($paths.Count -eq 0) { throw 'No tracked files; refusing an empty backup.' }
    $blockedPath = '(?i)(^|/)(\.env(?:\..*)?|\.ssh|\.aws|credentials?(?:\.[^/]*)?|secrets?|invitations?|manuscripts?|uploads?|ocr[-_](?:cache|output)|novel-writer-config\.json|novel-writer-cloud-session)(/|$)|\.(pdf|docx?|epub|db(?:\..*)?|sqlite3?(?:[-.].*)?|pem|key|pfx|p12)$|(^|/)(id_rsa|id_ed25519)$'
    $bad = @($paths | Where-Object { $_ -ne '.env.example' -and $_ -match $blockedPath })
    if ($bad.Count) { throw ('Sensitive file names are tracked. Backup stopped: ' + ($bad -join ', ')) }
    $null = Invoke-Git -GitArguments @('read-tree', '--empty') -SnapshotIndex
    $null = Invoke-Git -GitArguments @('update-index', '--add', '--remove', '-z', '--stdin') -InputText (($paths -join [char]0) + [char]0) -SnapshotIndex
    # Inspect the exact staged snapshot; report filenames only, never matching values.
    $secretPattern = '(^|[^a-zA-Z0-9_])(sk-(proj-)?[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}|AKIA[0-9A-Z]{16})|-----BEGIN (OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----'
    $secretFiles = Invoke-Git -GitArguments @('grep', '--cached', '--name-only', '-I', '-E', '-e', $secretPattern, '--', '.') -SnapshotIndex -AllowedCodes @(0, 1)
    if ($secretFiles) { throw ('Possible credentials detected. Backup stopped in: ' + $secretFiles) }
    $tree = Invoke-Git -GitArguments @('write-tree') -SnapshotIndex
    if ($ValidateOnly) { Write-BackupLog ('Validated {0} tracked paths; no commit.' -f $paths.Count); exit 0 }
    $ref = 'refs/heads/' + $config.branch
    $previous = Invoke-Git -GitArguments @('rev-parse', '--verify', '--quiet', $ref) -AllowedCodes @(0, 1)
    $parent = $previous
    if (-not $parent) { $parent = Invoke-Git -GitArguments @('rev-parse', 'HEAD') }
    $parentTree = Invoke-Git -GitArguments @('rev-parse', ($parent + '^{tree}'))
    $commit = $parent
    if ($tree -ne $parentTree) {
        $message = 'Automatic source backup ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
        $commit = Invoke-Git -GitArguments @('commit-tree', $tree, '-p', $parent) -InputText ($message + "`n")
    }
    if ($commit -ne $previous) {
        $expected = $previous
        if (-not $expected) { $expected = '0000000000000000000000000000000000000000' }
        $null = Invoke-Git -GitArguments @('update-ref', $ref, $commit, $expected)
        Write-BackupLog ('Local snapshot: ' + $commit.Substring(0, 12))
    }
    Write-BackupLog ('Local backup OK: ' + $config.branch + ' @ ' + $commit.Substring(0, 12))
    if ($config.mode -eq 'private-github' -and -not $LocalOnly) {
        Assert-PrivateDestination
        $null = Invoke-Git -GitArguments @('-c', 'http.proxy=', '-c', 'credential.interactive=false', 'push', '--porcelain', '--no-follow-tags', 'origin', ($ref + ':' + $ref))
        Write-BackupLog ('Private GitHub backup OK: ' + $config.branch + ' @ ' + $commit.Substring(0, 12))
    }
} catch {
    Write-BackupLog ('ERROR: ' + $_.Exception.Message)
    exit 1
} finally {
    if (Test-Path -LiteralPath $indexPath) { Remove-Item -LiteralPath $indexPath -Force }
    if (Test-Path -LiteralPath ($indexPath + '.lock')) { Remove-Item -LiteralPath ($indexPath + '.lock') -Force }
    if ($lock) { $lock.Dispose() }
}
