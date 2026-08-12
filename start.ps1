param(
    [int]$Port = 3100,
    [switch]$NoBrowser,
    [switch]$Dev
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$ui = Join-Path $root "ui"
$binary = Join-Path $root "target\release\cairn-harness.exe"

if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
    throw "GitHub Copilot CLI is required. Install it and run copilot login."
}

Push-Location $root
try {
    if ($Dev) {
        # Dev mode skips the production build/start pipeline. The backend binary is only
        # (re)built when missing, since UI iteration does not require a fresh Rust build.
        if (-not (Test-Path $binary)) {
            cargo build --release
        }
    } else {
        cargo build --release
    }
    & $binary install
    Push-Location $ui
    try {
        if (-not (Test-Path "node_modules")) {
            npm ci
        }
        $env:HARNESS_BIN = $binary
        $env:HARNESS_PROJECT_ROOT = Join-Path $root "projects"
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
        if ($Dev) {
            # `next dev` (Turbopack) serves Fast Refresh: UI edits apply in place, in well
            # under a second, with no npm run build/start cycle required.
            npm run dev -- --hostname 127.0.0.1 --port $Port
        } else {
            npm run build
            npm run start -- --hostname 127.0.0.1 --port $Port
        }
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}
