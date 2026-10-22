$ErrorActionPreference = 'Stop'
$base = Join-Path $PSScriptRoot ('../.local-recovery/git-auto-backup/verification-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $base 'work'
$remote = Join-Path $base 'remote.git'
$git = (Get-Command git.exe).Source
$ps = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$backup = Join-Path $PSScriptRoot 'git-auto-backup.ps1'
function Git([string[]]$GitArgs) {
    $result = & $git -C $repo @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Test git command failed: ' + ($result -join ' ')) }
    return ($result -join "`n")
}
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function RunBackup([int]$Expected = 0) {
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $backup, '-ConfigPath', (Join-Path $base 'config.json'))
    & $ps @arguments
    Assert ($LASTEXITCODE -eq $Expected) ('Backup exit code: ' + $LASTEXITCODE)
}
New-Item -ItemType Directory -Path $repo -Force | Out-Null
& $git init --bare $remote | Out-Null
& $git init -b main $repo | Out-Null
$null = Git @('remote', 'add', 'origin', $remote)
Set-Content -LiteralPath (Join-Path $repo 'code.ts') -Value 'initial' -Encoding UTF8
Set-Content -LiteralPath (Join-Path $repo 'removed.ts') -Value 'remove me' -Encoding UTF8
Set-Content -LiteralPath (Join-Path $repo 'notes.md') -Value 'capability-task-oriented-model-selection-policy' -Encoding UTF8
$null = Git @('add', '.')
$null = Git @('-c', 'user.name=Backup Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'initial')
$initialHead = Git @('rev-parse', 'HEAD')
Set-Content -LiteralPath (Join-Path $repo 'code.ts') -Value 'staged' -Encoding UTF8
$null = Git @('add', 'code.ts')
Set-Content -LiteralPath (Join-Path $repo 'code.ts') -Value 'working' -Encoding UTF8
$unicodeName = ([char]0x6D4B).ToString() + [char]0x8BD5 + '.ts'
Set-Content -LiteralPath (Join-Path $repo $unicodeName) -Value 'new tracked file' -Encoding UTF8
$null = Git @('add', $unicodeName)
Remove-Item -LiteralPath (Join-Path $repo 'removed.ts')
Set-Content -LiteralPath (Join-Path $repo 'private.pdf') -Value 'never upload' -Encoding UTF8
@{root=$repo; gitPath=$git; mode='local-only'; branch='backup/test'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $base 'config.json') -Encoding UTF8
$indexBefore = (Get-FileHash -LiteralPath (Join-Path $repo '.git/index')).Hash
RunBackup
$first = Git @('rev-parse', 'backup/test')
Assert ((Git @('show', 'backup/test:code.ts')).Trim() -eq 'working') 'Snapshot must contain working content.'
Assert ((Git @('show', 'backup/test:notes.md')).Trim() -eq 'capability-task-oriented-model-selection-policy') 'Ordinary task-oriented text must not be treated as a key.'
Assert ((Git @('show', ('backup/test:' + $unicodeName))).Trim() -eq 'new tracked file') 'Unicode staged file missing.'
$files = Git @('ls-tree', '-r', '--name-only', 'backup/test')
Assert ($files -notmatch 'private.pdf|removed.ts') 'Untracked or removed file included.'
Assert ((Git @('rev-parse', 'HEAD')) -eq $initialHead) 'HEAD changed.'
Assert ((Get-FileHash -LiteralPath (Join-Path $repo '.git/index')).Hash -eq $indexBefore) 'User index changed.'
RunBackup
Assert ((Git @('rev-parse', 'backup/test')) -eq $first) 'Unchanged tree created another commit.'
Assert (-not (& $git --git-dir=$remote for-each-ref '--format=%(refname)')) 'Local backup changed the remote.'
$null = Git @('remote', 'remove', 'origin')
RunBackup
Assert ((Git @('rev-parse', 'backup/test')) -eq $first) 'Local backup must work without a remote.'
Set-Content -LiteralPath (Join-Path $repo 'code.ts') -Value ('sk-' + ('a' * 40)) -Encoding UTF8
RunBackup -Expected 1
Assert ((Git @('rev-parse', 'backup/test')) -eq $first) 'Credential detection advanced the branch.'
Set-Content -LiteralPath (Join-Path $repo 'code.ts') -Value 'working' -Encoding UTF8
$null = Git @('add', 'private.pdf')
RunBackup -Expected 1
Assert ((Git @('rev-parse', 'backup/test')) -eq $first) 'Sensitive path detection advanced the branch.'
$null = Git @('rm', '--cached', 'private.pdf')
Set-Content -LiteralPath (Join-Path $repo 'code.ts') -Value 'offline snapshot' -Encoding UTF8
@{root=$repo; gitPath=$git; mode='private-github'; remoteUrl='https://github.com/HannJia/novel-ai-studio.git'; branch='backup/test'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $base 'config.json') -Encoding UTF8
RunBackup -Expected 1
$retained = Git @('rev-parse', 'backup/test')
Assert ($retained -ne $first) 'Local snapshot must survive upload failure.'
Assert ((Git @('show', 'backup/test:code.ts')).Trim() -eq 'offline snapshot') 'Retained snapshot content incorrect.'
Assert (-not (& $git --git-dir=$remote for-each-ref '--format=%(refname)')) 'Destination rejection wrote to a remote.'
@{root=$repo; gitPath=$git; mode='private-github'; remoteUrl='https://github.com/HannJia/novel-ai-studio-dev.git'; branch='backup/test'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $base 'config.json') -Encoding UTF8
$null = Git @('remote', 'add', 'origin', $remote)
RunBackup -Expected 1
Assert ((Git @('rev-parse', 'backup/test')) -eq $retained) 'Failed retry duplicated a snapshot.'
Assert ((Git @('rev-parse', 'HEAD')) -eq $initialHead) 'Development HEAD changed.'
Write-Output ('PASS: working content, staged new file, Unicode, deletion, index/HEAD preservation, unchanged retry, local-only mode, operation without origin, secret/private path blocking, private destination guards and local retention on upload failure. Fixtures: ' + $base)
