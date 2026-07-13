param(
    [int]$Port = 3100,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$ui = Join-Path $root "ui"

if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
    throw "GitHub Copilot CLI is required. Install it and run copilot login."
}

Push-Location $root
try {
    cargo build --release
    Push-Location $ui
    try {
        if (-not (Test-Path "node_modules")) {
            npm ci
        }
        npm run build
        $env:HARNESS_BIN = Join-Path $root "target\release\cairn-harness.exe"
        if (-not $NoBrowser) {
            $url = "http://127.0.0.1:$Port"
            Start-Job -ScriptBlock {
                param($Address)
                for ($attempt = 0; $attempt -lt 60; $attempt++) {
                    try {
                        Invoke-WebRequest -UseBasicParsing $Address | Out-Null
                        Start-Process $Address
                        return
                    } catch {
                        Start-Sleep -Milliseconds 250
                    }
                }
            } -ArgumentList $url | Out-Null
        }
        npm run start -- --hostname 127.0.0.1 --port $Port
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}
