param([string]$BaseUrl, [string]$SonnetModel, [string]$OpusModel)
$ErrorActionPreference = 'Stop'
Import-Module -Name (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$state = Join-Path $root '.local-recovery/model-team'
$configPath = Join-Path $state 'config.json'
$credentialPath = Join-Path $state 'credentials.json'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$config = Get-Content -LiteralPath (Join-Path $root 'tools/model-team.config.example.json') -Raw | ConvertFrom-Json
if (-not $BaseUrl) { $BaseUrl = $config.providers.relay.baseUrl }
$uri = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw 'Use an HTTPS Base URL without credentials, query parameters, or fragments.'
}
if ($uri.AbsolutePath -match '/responses/?$') { throw 'This bridge needs a Chat Completions endpoint.' }
if (-not $SonnetModel) { $SonnetModel = $config.providers.relay.models.sonnet.actualModelId }
if (-not $OpusModel) { $OpusModel = $config.providers.relay.models.opus.actualModelId }
if (-not $SonnetModel.Trim() -or -not $OpusModel.Trim()) { throw 'Exact model IDs are required.' }
$credentials = @{}
if (Test-Path -LiteralPath $credentialPath) {
    $existing = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) { $credentials[$property.Name] = $property.Value }
}
foreach ($provider in @('relay', 'deepseek')) {
    $secret = Read-Host ($provider + ' API key (hidden; leave blank to keep existing/skip)') -AsSecureString
    if ($secret.Length) { $credentials[$provider] = ConvertFrom-SecureString $secret }
    $secret.Dispose()
}
$config.providers.relay.baseUrl = $BaseUrl.Trim()
$config.providers.relay.protocol = 'openai-chat-completions'
$config.providers.relay.models.sonnet.actualModelId = $SonnetModel.Trim()
$config.providers.relay.models.opus.actualModelId = $OpusModel.Trim()
$config.requestsEnabled = $true
$config.status = 'configured-awaiting-live-probes'
$config.executionMode = 'local-api-bridge-current-codex-applies-reviews-and-tests'
$credentials | ConvertTo-Json | Set-Content -LiteralPath $credentialPath -Encoding UTF8
$config | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $configPath -Encoding UTF8
Write-Output 'Local configuration saved. Keys are encrypted for this Windows user and excluded from Git.'
Write-Output 'No API requests were sent. Run bridge.cjs status, then probe each configured role.'
