param([ValidateRange(5, 1440)][int]$IntervalMinutes = 30, [switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$gitPath = (Get-Command git.exe -ErrorAction Stop).Source
$expectedRemote = 'https://github.com/HannJia/novel-ai-studio-dev.git'
if (-not $LocalOnly) {
    $actualRemote = (& $gitPath -C $root remote get-url --push --all origin) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $actualRemote -ne $expectedRemote) { throw 'Origin must be the private development repository before installing.' }
}
$machine = ($env:COMPUTERNAME.ToLowerInvariant() -replace '[^a-z0-9-]', '-')
$branch = 'backup/auto-' + $machine
$taskName = 'NovelAIStudio-GitAutoBackup'
$stateDir = Join-Path $root '.local-recovery/git-auto-backup'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$configPath = Join-Path $stateDir 'config.json'
$mode = 'private-github'
if ($LocalOnly) { $mode = 'local-only' }
@{
    root = $root
    gitPath = $gitPath
    mode = $mode
    remoteUrl = $expectedRemote
    branch = $branch
    taskName = $taskName
    intervalMinutes = $IntervalMinutes
} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'git-auto-backup.ps1') -ConfigPath $configPath -ValidateOnly
if ($LASTEXITCODE -ne 0) { throw 'Backup validation failed; task was not registered.' }
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'git-auto-backup.ps1') + '"'
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $root
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$logon = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $repeat) -Principal $principal -Settings $settings -Description ('Git tracked source snapshots (' + $mode + '). Separate branch per computer. No release publishing. Logs: .local-recovery/git-auto-backup/backup.log') -Force | Select-Object TaskName, State
