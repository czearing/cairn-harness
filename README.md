# Cairn Harness

A high-performance Rust supervisor for asynchronous teams of authenticated local
GitHub Copilot CLI agents. It uses the installed `copilot` command and its OAuth
session; no model API token is required.

## MVP

- A project JSON defines a leader and roles.
- Each agent owns a durable Copilot session and an independent Tokio worker loop.
- SQLite provides atomic inbox claims, status, and crash-resistant coordination.
- Every assignment includes the team and current agent activity.
- A configured leader receives idempotent files from the project TODO directory.
- Short role prompts define responsibility.
- Agents communicate by emitting structured messages to roles or named workers.
- A semaphore enforces the configured maximum concurrent Copilot processes.
- Claim leases recover interrupted work after a crashed supervisor.
- Retry and per-start run budgets bound transient failures and agent ping-pong.
- Invalid recipients become durable dead letters instead of stopping the team.

Maintenance mode is intentionally deferred until the communication layer is
proven reliable.

## Run

```powershell
Copy-Item project.example.json project.json
cargo run -- --config project.json init
cargo run -- --config project.json send `
  --to pm --topic goal --body "Design and implement the requested feature."
cargo run -- --config project.json run
cargo run -- --config project.json step
cargo run -- --config project.json status
cargo run -- --config project.json transcript --full
```

Copilot CLI must already be authenticated with `copilot login`. Cairn remains
available through the user's normal Copilot MCP configuration. Set
`copilot.additional_mcp_config` when a project needs a dedicated MCP file.

## Protocol

Workers receive one claimed inbox message at a time. Their response must end
with a `CAIRN_ENVELOPE_BEGIN` / `CAIRN_ENVELOPE_END` JSON envelope containing a
summary, outgoing messages, and completion state. The harness expands role
recipients into durable per-agent messages.

Run one supervisor per project database. A claimed message is renewed while its
Copilot process runs and is returned to the inbox when its lease expires.

## Development

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Tests use fake runners and temporary SQLite databases. They do not invoke
Copilot or consume AI credits.

## Short-story demo

The demo config defines only a concept agent and a writer. The concept agent
creates one idea and sends one handoff; the writer produces the story without
replying.

```powershell
.\examples\short-story\run-demo.ps1 -Reset
```

The script uses separate harness processes for the story, continuity probe, and
transcript export. It fails if the concept agent's persisted Copilot session ID
changes across those restarts.

## Continuous poem loop

`producer` names the agent that receives a new seed whenever watch mode has no
pending work. Terminal deliverables are written to `releases/` and included in
future seeds.

```powershell
.\examples\poem-loop\run.ps1
```

Stop with Ctrl+C. Restart the same command to load durable messages, releases,
and ACP sessions.

## Async restaurant planning

TODO files may target an agent:

```text
to: pastry-chef
topic: dessert-menu

Create four desserts from docs/menu-direction.md.
```

The restaurant example proves a head chef can load a project skill, write shared
direction, create specialist TODOs, and let pastry and sauce work concurrently.
Captured ACP tool calls appear in the transcript.
