$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeDir = Join-Path $Root "node-v24.18.0-win-x64"
$env:PATH = "$NodeDir;" + $env:PATH
Set-Location $Root

if (!(Test-Path node_modules)) {
    Write-Host "Installing dependencies with local node..."
    npm install
}

Write-Host "Starting OverUnder dev stack..."
Write-Host "  API:     http://localhost:8010  (with --watch)"
Write-Host "  Web app: http://localhost:5173"

$api = Start-Process -FilePath "$NodeDir\node.exe" -ArgumentList "--watch", "src/main.ts" -WorkingDirectory $Root -NoNewWindow -PassThru
$web = Start-Process -FilePath "$NodeDir\npm.cmd" -ArgumentList "run", "web:dev" -WorkingDirectory $Root -NoNewWindow -PassThru

try {
    Start-Sleep -Seconds 3600
} finally {
    Stop-Process -Id $api.Id,$web.Id -Force -ErrorAction SilentlyContinue
}