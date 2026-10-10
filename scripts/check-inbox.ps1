param([string]$ProjectRoot = (Get-Location).Path)
$latest = Join-Path $ProjectRoot '.ai\inbox\LATEST.json'
if (!(Test-Path $latest)) {
    Write-Output 'NO_EVENT'
    exit 0
}
Get-Content $latest -Raw
