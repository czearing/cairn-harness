import type { DatabaseSync } from "node:sqlite";

export const OPERATOR_PAUSE_ERROR = "Paused by operator";

export function ensureOperatorPauseTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS operator_pauses (
    agent_id TEXT PRIMARY KEY
  )`);
  db.prepare(`INSERT OR IGNORE INTO operator_pauses(agent_id)
    SELECT DISTINCT agents.agent_id FROM agents
    JOIN tasks ON tasks.assignee=agents.agent_id
    WHERE agents.status='paused' AND tasks.status='deferred' AND tasks.error=?`)
    .run(OPERATOR_PAUSE_ERROR);
}
