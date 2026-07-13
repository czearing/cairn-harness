param(
    [switch]$Reset
)

$ErrorActionPreference = "Stop"
$demo = $PSScriptRoot
$repo = Resolve-Path (Join-Path $demo "..\..")
$manifest = Join-Path $repo "Cargo.toml"
$config = Join-Path $demo "project.json"
$state = Join-Path $demo ".cairn-harness"
$transcript = Join-Path $demo "transcript.md"

if ($Reset -and (Test-Path $state)) {
    Remove-Item -Recurse -Force $state
}
if ($Reset -and (Test-Path $transcript)) {
    Remove-Item -Force $transcript
}

cargo run --quiet --manifest-path $manifest -- --config $config step
$concept = cargo run --quiet --manifest-path $manifest -- --config $config transcript --json |
    ConvertFrom-Json
if (@($concept).Count -ne 1 -or $concept[0].agent_id -ne "concept" -or
    $concept[0].status -ne "completed") {
    throw "Concept step failed."
}
$title = (@($concept[0].output.messages)[0].body -split "`n" |
    Where-Object { $_ -like "Title:*" } |
    Select-Object -First 1) -replace "^Title:\s*", ""

cargo run --quiet --manifest-path $manifest -- --config $config step
$story = cargo run --quiet --manifest-path $manifest -- --config $config transcript --json |
    ConvertFrom-Json
if (@($story).Count -ne 2 -or $story[1].agent_id -ne "writer" -or
    $story[1].status -ne "completed") {
    throw "Writer step failed."
}

cargo run --quiet --manifest-path $manifest -- --config $config send `
    --to concept `
    --topic context-probe `
    --body "Without reading files or asking another agent, return the exact title from your previous concept."

cargo run --quiet --manifest-path $manifest -- --config $config step

$json = cargo run --quiet --manifest-path $manifest -- --config $config transcript --json |
    ConvertFrom-Json
if (@($json).Count -ne 3) {
    throw "Expected exactly three turns: concept, writer, continuity probe."
}
if (@($json | Where-Object status -ne "completed").Count -ne 0) {
    throw "One or more agent turns failed."
}
if ($json[0].agent_id -ne "concept" -or $json[1].agent_id -ne "writer") {
    throw "Story flow did not run concept then writer."
}
if (@($json[0].output.messages).Count -ne 1 -or
    @($json[1].output.messages).Count -ne 0) {
    throw "Story flow used redundant peer communication."
}
$conceptSessions = @($json | Where-Object agent_id -eq "concept" |
    Select-Object -ExpandProperty session_id -Unique)
if ($conceptSessions.Count -ne 1) {
    throw "Concept session changed across harness restarts."
}
if ($json[-1].output.deliverable.Trim() -ne $title.Trim()) {
    throw "Continuity probe did not return the original title."
}

cargo run --quiet --manifest-path $manifest -- --config $config transcript --full |
    Set-Content -Path $transcript

Write-Output "Transcript: $transcript"
Write-Output "Concept session preserved: $($conceptSessions[0])"
