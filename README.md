# Harness

A lightweight local app for running teams of GitHub Copilot CLI agents in the
background. Agents keep their sessions, share work, recover after restarts, and
stay visible in one chat-first UI.

![Harness dashboard](docs/dashboard.png)

## Start

Install Rust, Node.js 20+, and GitHub Copilot CLI. Sign in once:

```powershell
copilot login
```

Then launch the app:

```powershell
.\start.ps1
```

The dashboard opens at `http://127.0.0.1:3100`. Starting the UI also starts one
worker for every configured project.

## Use

Create a project from the left rail, add agents, and start messaging or adding
work. Each agent has its own durable Copilot session and identity color.

The conversation shows:

- Your messages
- Agent replies
- Messages between agents
- Completed turns
- Tool activity
- Session starts, stops, and restored history

Project state lives in `.cairn-harness/`. Closing and reopening the app does not
discard messages, work, or agent sessions.

## Project file

Projects can also be defined with a small JSON file:

```json
{
  "name": "example-product",
  "root": ".",
  "leader": "pm",
  "roles": [
    {
      "name": "pm",
      "description": "Product manager",
      "prompt": "Define scope, delegate work, and verify the result."
    },
    {
      "name": "builder",
      "description": "Software engineer",
      "prompt": "Implement assigned work and report what changed."
    }
  ]
}
```

Set `HARNESS_PROJECTS` to a semicolon-separated list of project files before
launching the app. The included examples are discovered automatically.

## Development

```powershell
cargo test
cd ui
npm run test:e2e
```
