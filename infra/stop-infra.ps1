# Stops the services started by start-infra.ps1 (by the process ids it saved).
$Data = Join-Path (Split-Path -Parent $PSScriptRoot) ".data"
foreach ($name in "mailpit", "seaweedfs", "redis", "mongodb") {
    $pidFile = Join-Path $Data "$name.pid"
    if (Test-Path $pidFile) {
        $procId = [int](Get-Content $pidFile)
        try { Stop-Process -Id $procId -ErrorAction Stop; Write-Host "stopped $name (pid $procId)" } catch { Write-Host "$name was not running" }
        Remove-Item $pidFile
    }
}
