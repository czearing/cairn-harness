---
name: cairn-harness
description: Create and operate persistent local agent teams in Cairn Harness, including projects, leaders, agents, delegated work, and direct assignments.
license: MIT
---

# Cairn Harness

Use the running Harness API at `http://127.0.0.1:3100`. Never create or edit
Harness databases directly.

1. Confirm `GET /api/projects` succeeds before making changes.
2. Reuse an existing project when its `root` matches the requested workspace.
   Otherwise create it with `POST /api/projects` and JSON
   `{"name":"...","workspace":"C:\\absolute\\path"}`.
3. Create each team member with
   `POST /api/projects/{projectId}/agents` and JSON containing `name`,
   `description`, and concise outcome-focused `prompt` fields. Add `model` only
   when the user explicitly requests one.
4. Make the intended leader with
   `PATCH /api/projects/{projectId}/agents/{agentId}` and JSON
   `{"action":"make-leader"}`.
5. Submit work for team delegation with
   `POST /api/projects/{projectId}/work-items` and JSON `{"body":"..."}`.
   Include the outcome, scope boundaries, acceptance checks, and instruction for
   the leader to delegate disjoint parts to the configured team.
6. Send a direct assignment or follow-up to one agent with
   `POST /api/projects/{projectId}/messages` and JSON
   `{"agent":"agent-id","body":"...","submissionId":"unique-id"}`.
7. After every mutation, require a successful HTTP status and inspect the JSON
   response. Stop and report the exact API error instead of editing storage.
8. Re-read `GET /api/projects` and confirm the project, leader, agents, and work
   counts reflect the requested operation.

Use platform-native HTTP tooling. In PowerShell, prefer `Invoke-RestMethod` with
`ConvertTo-Json`; on other systems, use `curl` with explicit JSON headers.
