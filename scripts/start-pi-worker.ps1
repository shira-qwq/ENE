param(
    [Parameter(Mandatory=$true)][ValidatePattern('^C[0-9]{3,}$')][string]$ChangeId,
    [string]$ProjectRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$WorkerScript = Join-Path $ProjectRoot 'scripts\pi-worker.ps1'
$Card = Join-Path $ProjectRoot ("changes\active\{0}.md" -f $ChangeId)

if (!(Test-Path $WorkerScript)) { throw "Missing worker script: $WorkerScript" }
if (!(Test-Path $Card)) { throw "Missing Build Card: $Card" }
if (!(Test-Path (Join-Path $ProjectRoot '.ai\runtime.json'))) { throw 'Missing .ai/runtime.json' }
Get-Command pi -ErrorAction Stop | Out-Null

$JobDir = Join-Path $ProjectRoot '.ai\jobs'
New-Item -ItemType Directory -Force -Path $JobDir | Out-Null

foreach ($Existing in (Get-ChildItem $JobDir -Filter '*.json' -ErrorAction SilentlyContinue)) {
    try {
        $j = Get-Content $Existing.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) {
            $existingProcess = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f [int]$j.pid) -ErrorAction SilentlyContinue
            if ($existingProcess -and ($existingProcess.CommandLine -like '*pi-worker.ps1*' -or $existingProcess.CommandLine -like '*pipe-worker.mjs*') -and $existingProcess.CommandLine.Contains($ProjectRoot)) {
                throw "A worker for $($j.change_id) is still running in this shared checkout (PID $($j.pid))."
            }
        }
    } catch {
        if ($_.Exception.Message -like 'A worker*') { throw }
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$JobFile = Join-Path $JobDir ("{0}-{1}.json" -f $ChangeId,$stamp)

$workerArguments = @(
    '-NoProfile','-ExecutionPolicy','Bypass',
    '-File', ('"{0}"' -f $WorkerScript),
    '-ProjectRoot', ('"{0}"' -f $ProjectRoot),
    '-ChangeId', $ChangeId
)

$p = Start-Process -FilePath 'powershell.exe' -ArgumentList $workerArguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru

@{
    change_id = $ChangeId
    pid = $p.Id
    started_at = (Get-Date).ToString('o')
    project_root = $ProjectRoot
    state = 'RUNNING'
} | ConvertTo-Json | Set-Content -Encoding UTF8 $JobFile

Write-Output "JOB_STARTED $ChangeId PID=$($p.Id)"
Write-Output "Codex should stop waiting now. Final event will appear under .ai\inbox\."
