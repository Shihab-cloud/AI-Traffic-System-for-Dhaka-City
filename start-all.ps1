# Starts the whole system on this laptop, each part in its own window:
#   infrastructure (MongoDB, Redis, SeaweedFS S3, Mailpit) -> backend :5001 -> vision service :8601 -> frontend :3000
# Usage (from this folder):  powershell -ExecutionPolicy Bypass -File start-all.ps1
# Stop: close the three windows, then  powershell -ExecutionPolicy Bypass -File infra\stop-infra.ps1
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Node = Join-Path $Root ".tools\node"
$Python = Join-Path $Root ".venv\Scripts\python.exe"   # the CUDA venv, in this folder since 2026-10-28

function Start-Window($title, $dir, $command) {
    $cmd = "`$host.UI.RawUI.WindowTitle = '$title'; `$env:PATH = '$Node;' + `$env:PATH; Set-Location '$dir'; $command"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd | Out-Null
    Write-Host "started $title"
}

& (Join-Path $Root "infra\start-infra.ps1")

$backend = Join-Path $Root "apps\backend"
if (-not (Test-Path (Join-Path $backend "dist\src\main.js"))) {
    Write-Host "Building the backend (first run)..."
    Push-Location $backend
    & (Join-Path $Node "node.exe") (Join-Path $Root "node_modules\@nestjs\cli\bin\nest.js") build
    Pop-Location
}
Start-Window "backend :5001" $backend "node dist\src\main"
Start-Window "vision :8601" (Join-Path $Root "vision") "& '$Python' server.py"
Start-Window "frontend :3000" (Join-Path $Root "apps\frontend") "node ..\..\node_modules\next\dist\bin\next dev -p 3000"

Write-Host ""
Write-Host "Portal:      http://localhost:3000   (first compile of each page takes a few seconds)"
Write-Host "Mail inbox:  http://127.0.0.1:8025   (every email the system sends: tickets, invoices)"
Write-Host "API docs:    http://localhost:5001/swagger"
