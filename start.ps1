$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$env:NODE_ENV = "production"

if (!(Test-Path "web\dist")) {
    Write-Host "Building web bundle first..."
    if (!(Test-Path node_modules)) {
        $NodeDir = Join-Path $Root "node-v24.18.0-win-x64"
        $env:PATH = "$NodeDir;" + $env:PATH
        npm install
    }
    npm run build:web
}

# Production serves API + built dashboard; use local node when present, else platform node.
$LocalNode = Join-Path $Root "node-v24.18.0-win-x64\node.exe"
if (Test-Path $LocalNode) {
    & $LocalNode "src\main.ts"
} else {
    node "src\main.ts"
}