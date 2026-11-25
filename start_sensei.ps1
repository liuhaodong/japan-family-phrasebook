# One-click launcher for Nihongo Sensei AI local server
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$py = Join-Path $PSScriptRoot "server\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Error "Python virtual environment not found at $py"
    exit 1
}

Write-Host "Starting Nihongo Sensei AI on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
& $py -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --ws-ping-interval 20 --ws-ping-timeout 20
