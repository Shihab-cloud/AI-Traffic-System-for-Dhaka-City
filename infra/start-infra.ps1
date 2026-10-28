# Starts the local services the web system needs, all bound to localhost, data under .data\:
#   MongoDB 8.0  one-node replica set "rs0" on 27017   (the backend uses transactions -> must be a replica set)
#   Redis 8      on 6379                               (job queues, auth rate limits)
#   SeaweedFS    S3 API on 8333                        (evidence images; AWS S3 in production)
#   Mailpit      SMTP on 1025, inbox on http://127.0.0.1:8025   (catches all mail locally; real SMTP in production)
# Usage:  powershell -ExecutionPolicy Bypass -File infra\start-infra.ps1      (stop: infra\stop-infra.ps1)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root ".tools"
$Data = Join-Path $Root ".data"
$Logs = Join-Path $Data "logs"
foreach ($d in "mongo", "redis", "seaweed", "logs") { New-Item -ItemType Directory -Force (Join-Path $Data $d) | Out-Null }

function Test-Port($port) {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", $port); $c.Close(); return $true } catch { return $false }
}

function Start-Service-Exe($name, $port, $exe, $argList) {
    if (Test-Port $port) { Write-Host "$name already running on $port"; return }
    $p = Start-Process -FilePath $exe -ArgumentList $argList -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $Logs "$name.out.log") -RedirectStandardError (Join-Path $Logs "$name.err.log")
    Set-Content -Path (Join-Path $Data "$name.pid") -Value $p.Id
    for ($i = 0; $i -lt 60 -and -not (Test-Port $port); $i++) { Start-Sleep -Milliseconds 500 }
    if (Test-Port $port) { Write-Host "$name started on $port (pid $($p.Id))" } else { throw "$name did not start - see $Logs" }
}

$mongod = Get-ChildItem (Join-Path $Tools "mongodb") -Recurse -Filter mongod.exe | Select-Object -First 1
Start-Service-Exe "mongodb" 27017 $mongod.FullName @(
    "--replSet", "rs0", "--bind_ip", "127.0.0.1", "--port", "27017",
    "--dbpath", "`"$(Join-Path $Data 'mongo')`"", "--wiredTigerCacheSizeGB", "0.25")

$redis = Get-ChildItem (Join-Path $Tools "redis") -Recurse -Filter redis-server.exe | Select-Object -First 1
Start-Service-Exe "redis" 6379 $redis.FullName @(
    "--bind", "127.0.0.1", "--port", "6379", "--dir", "`"$((Join-Path $Data 'redis') -replace '\\', '/')`"",
    "--save", "300", "10", "--maxmemory", "128mb")

$weed = Join-Path $Tools "seaweedfs\weed.exe"
Start-Service-Exe "seaweedfs" 8333 $weed @(
    "server", "-ip=127.0.0.1", "-ip.bind=127.0.0.1", "-dir=`"$(Join-Path $Data 'seaweed')`"",
    "-master.volumeSizeLimitMB=1024", "-s3", "-s3.port=8333", "-s3.config=`"$(Join-Path $PSScriptRoot 's3.json')`"")

$mailpit = Join-Path $Tools "mailpit\mailpit.exe"
Start-Service-Exe "mailpit" 1025 $mailpit @(
    "--smtp", "127.0.0.1:1025", "--listen", "127.0.0.1:8025", "--smtp-auth-accept-any", "--smtp-auth-allow-insecure",
    "--database", "`"$(Join-Path $Data 'mailpit.db')`"")
Write-Host "Mail inbox (every email the system sends): http://127.0.0.1:8025"

# Replica set + S3 bucket (idempotent)
& (Join-Path $Tools "node\node.exe") (Join-Path $PSScriptRoot "init-infra.mjs")
