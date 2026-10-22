$ErrorActionPreference = 'Stop'
# Start-Process can inherit PowerShell 7 module paths; load this host's built-in module explicitly.
Import-Module -Name (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ModelTeamDialogVisibility {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int mode);
}
'@
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$state = Join-Path $root '.local-recovery/model-team'
$template = Join-Path $root 'tools/model-team.config.example.json'
$config = Get-Content -LiteralPath $template -Raw | ConvertFrom-Json
$form = New-Object Windows.Forms.Form
$form.Text = 'Model team - ipc.wiki API keys (fixed)'
$form.ClientSize = New-Object Drawing.Size(650, 325)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
# Hidden PowerShell startup can also hide its first GUI window. Show only this form.
$form.Add_Shown({
    [void][ModelTeamDialogVisibility]::ShowWindowAsync($form.Handle, 1)
    $form.Activate()
})
$info = New-Object Windows.Forms.Label
$info.Location = New-Object Drawing.Point(20, 15)
$info.Size = New-Object Drawing.Size(610, 105)
$info.Text = "Keys stay on this PC, encrypted for your Windows account.`r`nNo keys are sent to chat or Git. Saving does not send API requests.`r`nRelay: $($config.providers.relay.baseUrl)`r`nSonnet: $($config.providers.relay.models.sonnet.actualModelId)`r`nOpus: $($config.providers.relay.models.opus.actualModelId)"
$form.Controls.Add($info)
$boxes = @{}
$positions = @{relay=135; deepseek=195}
foreach ($provider in @('relay', 'deepseek')) {
    $label = New-Object Windows.Forms.Label
    $label.Location = New-Object Drawing.Point(20, $positions[$provider])
    $label.Size = New-Object Drawing.Size(610, 20)
    $label.Text = if ($provider -eq 'relay') { 'Relay API key (Opus / Sonnet)' } else { 'Official DeepSeek API key (optional; can add later)' }
    $box = New-Object Windows.Forms.TextBox
    $box.Location = New-Object Drawing.Point(20, ($positions[$provider] + 23))
    $box.Size = New-Object Drawing.Size(610, 24)
    $box.UseSystemPasswordChar = $true
    $boxes[$provider] = $box
    $form.Controls.Add($label)
    $form.Controls.Add($box)
}
$save = New-Object Windows.Forms.Button
$save.Text = 'Save locally'
$save.Location = New-Object Drawing.Point(385, 275)
$save.Size = New-Object Drawing.Size(115, 30)
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.Location = New-Object Drawing.Point(515, 275)
$cancel.Size = New-Object Drawing.Size(115, 30)
$cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancel
$form.AcceptButton = $save
$form.Controls.Add($save)
$form.Controls.Add($cancel)
$save.Add_Click({
    $saveStage = 'read-existing-config'
    try {
        $credentials = @{}
        $credentialPath = Join-Path $state 'credentials.json'
        if (Test-Path -LiteralPath $credentialPath) {
            $existing = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
            foreach ($property in $existing.PSObject.Properties) { $credentials[$property.Name] = $property.Value }
        }
        foreach ($provider in @('relay', 'deepseek')) {
            if ($boxes[$provider].Text.Trim()) {
                $saveStage = 'encrypt-' + $provider
                $secure = ConvertTo-SecureString $boxes[$provider].Text.Trim() -AsPlainText -Force
                try { $credentials[$provider] = ConvertFrom-SecureString $secure }
                finally { $secure.Dispose() }
            }
        }
        $saveStage = 'validate-keys'
        if (-not $credentials.relay) {
            [void][Windows.Forms.MessageBox]::Show('Enter the relay key to enable Sonnet and Opus.', 'Key required')
            return
        }
        $saveStage = 'create-local-directory'
        New-Item -ItemType Directory -Path $state -Force | Out-Null
        $saveStage = 'prepare-config'
        $config.requestsEnabled = $true
        $config.status = 'configured-awaiting-live-probes'
        $saveStage = 'write-encrypted-keys'
        $credentials | ConvertTo-Json | Set-Content -LiteralPath $credentialPath -Encoding UTF8
        $saveStage = 'write-config'
        $config | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $state 'config.json') -Encoding UTF8
        $saveStage = 'close-dialog'
        foreach ($box in $boxes.Values) { $box.Clear() }
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    } catch {
        # Exception messages and invocation text may contain input. Store metadata only.
        $diagnostic = [ordered]@{
            at = [DateTime]::UtcNow.ToString('o')
            stage = $saveStage
            exceptionType = $_.Exception.GetType().FullName
            hresult = $_.Exception.HResult
            line = $_.InvocationInfo.ScriptLineNumber
        }
        try {
            New-Item -ItemType Directory -Path $state -Force | Out-Null
            $diagnostic | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'save-diagnostic.json') -Encoding UTF8
        } catch { }
        [void][Windows.Forms.MessageBox]::Show("Could not save at step: $saveStage.`r`nNo API requests were sent. Your input is still in this window.`r`nOnly an error code (no keys) was saved for diagnosis.", 'Save failed')
    }
})
try {
    $result = $form.ShowDialog()
    if ($result -ne [Windows.Forms.DialogResult]::OK) { exit 2 }
} finally { foreach ($box in $boxes.Values) { $box.Clear() }; $form.Dispose() }
