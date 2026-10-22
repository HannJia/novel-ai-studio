$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$fixture = Join-Path $root ('.local-recovery/model-team/windows-test-' + [Guid]::NewGuid().ToString('N'))
$state = Join-Path $fixture '.local-recovery/model-team'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'configure-dialog.ps1') -Raw
$source = $source.Replace('$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ''../..''))', ('$root = ''' + $root.Replace("'", "''") + ''''))
$source = $source.Replace('$state = Join-Path $root ''.local-recovery/model-team''', ('$state = ''' + $state.Replace("'", "''") + ''''))
$source = $source.Replace('$save.Add_Click({', @'
$boxes['relay'].Text = 'local-noncredential-probe-relay'
$boxes['deepseek'].Text = 'local-noncredential-probe-deepseek'
$save.Add_Click({
'@)
$source = $source.Replace('$result = $form.ShowDialog()', '$form.Add_Shown({ $save.PerformClick() }); $result = $form.ShowDialog()')
# Keep a failing test noninteractive. All test inputs are fixed fake values.
$source = $source -replace '(?m)^        \[void\]\[Windows.Forms.MessageBox\]::Show\("Could not save at step:.*$', '        $form.DialogResult = [Windows.Forms.DialogResult]::Abort; $form.Close()'
$scriptPath = Join-Path $fixture 'dialog-test.ps1'
[IO.File]::WriteAllText($scriptPath, $source)
$output = Join-Path $fixture 'stdout.txt'
$errors = Join-Path $fixture 'stderr.txt'
$process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',('"' + $scriptPath + '"')) -WindowStyle Hidden -RedirectStandardOutput $output -RedirectStandardError $errors -PassThru
$null = $process.Handle
if (-not $process.WaitForExit(20000)) {
    Stop-Process -Id $process.Id
    throw 'Hidden-window save test timed out.'
}
if ($process.ExitCode -ne 0) {
    $diagnosticPath = Join-Path $state 'save-diagnostic.json'
    if (Test-Path -LiteralPath $diagnosticPath) { Get-Content -LiteralPath $diagnosticPath }
    throw 'Hidden-window save test failed.'
}
$config = Get-Content -LiteralPath (Join-Path $state 'config.json') -Raw | ConvertFrom-Json
$encrypted = Get-Content -LiteralPath (Join-Path $state 'credentials.json') -Raw
if (-not $config.requestsEnabled -or $encrypted.Contains('local-noncredential-probe')) { throw 'Encrypted storage test failed.' }
Write-Output 'Hidden Windows PowerShell GUI save passed; fake keys encrypted.'
$nodeTest = @'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { performCall } = require(process.argv[2])
const root = process.argv[3]
const config = JSON.parse(fs.readFileSync(path.join(root, '.local-recovery/model-team/config.json'), 'utf8').replace(/^\uFEFF/, ''))
delete process.env.MODEL_TEAM_RELAY_API_KEY
delete process.env.MODEL_TEAM_DEEPSEEK_API_KEY
;(async () => {
  for (const [role, suffix] of [['implementer', 'relay'], ['scout', 'deepseek']]) {
    await performCall({ root, config, role, task: 'Local credential test. No network.', fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, `Bearer local-noncredential-probe-${suffix}`)
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Local test passed.' } }] }), { status: 200 })
    } })
  }
  console.log('Node bridge decrypted both fake keys; mocked transport only, no HTTP requests.')
})().catch(() => { console.error('Local credential decryption test failed.'); process.exitCode = 1 })
'@
$nodePath = Join-Path $fixture 'decrypt-test.cjs'
[IO.File]::WriteAllText($nodePath, $nodeTest)
& node $nodePath (Join-Path $PSScriptRoot 'bridge.cjs') $fixture
if ($LASTEXITCODE -ne 0) { throw 'Bridge credential test failed.' }
