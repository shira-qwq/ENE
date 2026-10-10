param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [Parameter(Mandatory=$true)][ValidatePattern('^C[0-9]{3,}$')][string]$ChangeId
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
Set-Location -LiteralPath $ProjectRoot
$V11Config = Get-Content -LiteralPath (Join-Path $ProjectRoot '.ai/runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($V11Config.v1_1) {
    & node (Join-Path $ProjectRoot 'scripts/pipe-worker.mjs') $ProjectRoot $ChangeId
    if ($LASTEXITCODE -ne 0) { throw 'V1.1 worker failed before it could save a terminal state.' }
    $V11Run = Get-Content -LiteralPath (Join-Path $ProjectRoot '.ai/runs/current.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($V11Run.status -eq 'finished' -and $V11Config.show_windows_notification) {
        try {
            $V11Event = Get-Content -LiteralPath (Join-Path $ProjectRoot '.ai/inbox/LATEST.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            $V11Popup = New-Object -ComObject WScript.Shell
            $V11Popup.Popup(("{0}: {1}{2}{3}" -f $ChangeId,$V11Event.status,[Environment]::NewLine,$V11Event.summary),10,'AI Build',64) | Out-Null
        } catch {}
    }
    return
}
$AiDir = Join-Path $ProjectRoot '.ai'
$OutboxDir = Join-Path $AiDir 'outbox'
$InboxDir = Join-Path $AiDir 'inbox'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$RunDir = Join-Path $AiDir ("runs\{0}-{1}" -f $ChangeId,$stamp)
foreach ($dir in @($RunDir,$OutboxDir,$InboxDir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$Events = Join-Path $RunDir 'events.jsonl'
$Stderr = Join-Path $RunDir 'stderr.log'
$Outbox = Join-Path $OutboxDir ("{0}.json" -f $ChangeId)
$ReceiptRelative = "receipts/$ChangeId.md"
$Receipt = Join-Path $ProjectRoot $ReceiptRelative
$runtime = $null
$exitCode = 999
$failure = ''
$sessionId = [guid]::NewGuid().ToString()
try {
    $Card = Join-Path $ProjectRoot "changes/active/$ChangeId.md"
    $BuilderContract = Join-Path $ProjectRoot 'BUILDER_CONTRACT.md'
    foreach ($file in @($Card,$BuilderContract,(Join-Path $AiDir 'runtime.json'))) {
        if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing required input: $file" }
    }
    $runtime = Get-Content -LiteralPath (Join-Path $AiDir 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$runtime.model -or !$runtime.provider_extension) { throw 'Runtime model/provider extension missing.' }
    if (!(Test-Path -LiteralPath $runtime.provider_extension -PathType Leaf)) { throw 'Configured provider extension not found.' }
    if (Test-Path -LiteralPath $Outbox) { Remove-Item -LiteralPath $Outbox -Force }
    $piArgs = @('--print','--mode','json','--offline','--session-id',$sessionId,'--session-dir',$RunDir,
        '--name',("build-{0}-{1}" -f $ChangeId,$sessionId),
        '--no-extensions','-e',[string]$runtime.provider_extension,'--no-skills','--no-prompt-templates','--no-themes',
        '--tools','read,bash,powershell,edit,write,grep,find,ls',
        '--provider',[string]$runtime.provider,'--model',[string]$runtime.model,'--thinking',[string]$runtime.thinking,
        ('@' + $BuilderContract), ('@' + $Card),
        ("Execute Change {0} from repository reality. Read AGENTS.md and EVENT_PROTOCOL.md. Do not read old chat/session history. Commit the result, save receipts/{0}.md, write exactly one terminal .ai/outbox/{0}.json, then stop. Emit OWNER_DECISION for product ambiguity; NEEDS_CODEX for targeted diagnosis; FAILED for infrastructure failure. Never create another Change." -f $ChangeId))
    # Windows PowerShell treats native stderr as ErrorRecord. PI's fresh-session
    # warning is not a process failure; retain stderr and judge the exit code.
    $savedErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & pi @piArgs 1> $Events 2> $Stderr
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorPreference
    }
} catch {
    $failure = $_.Exception.Message
    $_ | Out-String | Add-Content -Encoding UTF8 -LiteralPath $Stderr
    $exitCode = 998
}
@{change_id=$ChangeId; exit_code=$exitCode; finished_at=(Get-Date).ToString('o'); run_dir=$RunDir; fresh_session=$sessionId} |
    ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $RunDir 'exit.json')
$event = $null
if (!$failure -and (Test-Path -LiteralPath $Outbox)) {
    try { $event = Get-Content -LiteralPath $Outbox -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $failure = 'Invalid terminal event JSON.' }
}
if (!$failure -and (!$event -or $event.change_id -ne $ChangeId -or
    $event.status -notin @('RESULT_READY','OWNER_DECISION','NEEDS_CODEX','FAILED') -or !$event.summary)) {
    $failure = 'Missing or invalid terminal event.'
}
if (!$failure -and $exitCode -ne 0 -and $event.status -ne 'FAILED') { $failure = "PI exited abnormally: $exitCode" }
if (!$failure -and $event.status -eq 'RESULT_READY') {
    try {
        if ($event.receipt -ne $ReceiptRelative -or !(Test-Path -LiteralPath $Receipt -PathType Leaf)) { throw 'Declared receipt missing or mismatched.' }
        if (!$event.result_commit -or $event.result_commit -notmatch '^[a-fA-F0-9]{7,40}$') { throw 'RESULT_READY needs a real result commit.' }
        & git cat-file -e ("{0}^{{commit}}" -f $event.result_commit) 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Result commit does not exist in Git.' }
        if (!$event.owner_result) { throw 'Owner result missing.' }
        if ([string]$event.owner_result -match '^https?://') {
            $response = Invoke-WebRequest -Uri $event.owner_result -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -ne 200) { throw 'Owner result URL unavailable.' }
        } else {
            $candidate = [IO.Path]::GetFullPath((Join-Path $ProjectRoot ([string]$event.owner_result)))
            $rootPrefix = $ProjectRoot.TrimEnd('\') + '\'
            if (!$candidate.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'Owner result file missing or outside project.' }
        }
    } catch { $failure = $_.Exception.Message }
}
if ($failure) {
    $event = [pscustomobject]@{change_id=$ChangeId;status='FAILED';summary=$failure;owner_result='';receipt=$ReceiptRelative;result_commit='';needs_codex=$false}
}
# Copy only the seven protocol fields; never forward PI tool/progress/thought logs.
$terminal = [ordered]@{
    change_id=$ChangeId; status=[string]$event.status; summary=[string]$event.summary;
    owner_result=[string]$event.owner_result; receipt=[string]$event.receipt;
    result_commit=[string]$event.result_commit; needs_codex=($event.status -eq 'NEEDS_CODEX')
}
$json = $terminal | ConvertTo-Json -Depth 8
$json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $InboxDir "$stamp-$ChangeId.json")
$json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $InboxDir 'LATEST.json')
if ($runtime -and $runtime.auto_open_result -and $terminal.status -eq 'RESULT_READY') {
    try {
        $target = [string]$terminal.owner_result
        if ($target -notmatch '^https?://') { $target = Join-Path $ProjectRoot $target }
        Start-Process $target
    } catch {}
}
if ($runtime -and $runtime.show_windows_notification) {
    try {
        # Native bounded notification; no indefinite MessageBox wait.
        $popup = New-Object -ComObject WScript.Shell
        $popup.Popup(("{0}: {1}{2}{3}" -f $ChangeId,$terminal.status,[Environment]::NewLine,$terminal.summary),10,'AI Build',64) | Out-Null
    } catch {}
}
