# Cairn Harness

A high-performance Rust supervisor for asynchronous teams of authenticated local
GitHub Copilot CLI agents. It uses the installed `copilot` command and its OAuth
session; no model API token is required.

## MVP

- A project JSON defines roles, contracts, ownership, replicas, and process caps.
- Each agent owns a durable Copilot session and an independent Tokio worker loop.
- SQLite provides atomic inbox claims, status, and crash-resistant coordination.
- Every assignment includes all role contracts and current agent activity.
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
cargo run -- --config project.json status
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
