$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$manifest = Join-Path $repo "Cargo.toml"
$config = Join-Path $PSScriptRoot "project.json"

cargo run --quiet --manifest-path $manifest -- --config $config watch
