$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/ws/package.json'))) {
    Push-Location -LiteralPath $taskRoot
    try { npm ci --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' } }
    finally { Pop-Location }
}
$running = $false
try { $running = (Invoke-WebRequest -Uri 'http://127.0.0.1:4317/' -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $running) {
    New-Item -ItemType Directory -Force -Path (Join-Path $taskRoot 'logs') | Out-Null
    $nodeExe = (Get-Command node).Source
    Start-Process -FilePath $nodeExe -ArgumentList 'app.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'logs/launcher.log') -RedirectStandardError (Join-Path $taskRoot 'logs/launcher-error.log')
    Start-Sleep -Milliseconds 800
}
Start-Process 'http://127.0.0.1:4317/'
