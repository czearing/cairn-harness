import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export function resetAgentContext(db: DatabaseSync, root: string, agentId: string, clearedAt: string) {
  const result = db.prepare("UPDATE agents SET session_id='',status='idle',current_topic=NULL,updated_at=? WHERE agent_id=?")
    .run(clearedAt, agentId);
  if (!result.changes) throw new Error("Agent not found");
  db.prepare("UPDATE tasks SET status='pending',claimed_at=NULL WHERE assignee=? AND status='claimed'")
    .run(agentId);
  deleteConversationHistory(db, agentId);
  // The chat is read from the Copilot CLI's own session logs first and the database second, so a
  // clear that only touches SQLite leaves the visible transcript fully intact. Remove both. A live
  // runner can still hold events.jsonl open on Windows, so retry rather than reporting a false clear.
  const logs = path.join(root, ".cairn-harness", "copilot-home", agentId, "session-state");
  rmSync(logs, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  if (existsSync(logs)) throw new Error("Could not delete the agent's session logs; it may still be running");
  // The agent also replays its own completed turns into a fresh session. The watermark keeps that
  // replay off for any turn recorded before this point that deletion cannot reach.
  db.exec("CREATE TABLE IF NOT EXISTS context_resets (agent_id TEXT PRIMARY KEY, cleared_at TEXT NOT NULL)");
  db.prepare(`INSERT INTO context_resets(agent_id,cleared_at) VALUES(?,?)
    ON CONFLICT(agent_id) DO UPDATE SET cleared_at=excluded.cleared_at`).run(agentId, clearedAt);
  rmSync(path.join(root, ".cairn-harness", "ui-session-cache", agentId), { recursive: true, force: true });
}

const TERMINAL = "('completed','failed','cancelled','dead-letter')";

// The transcript the operator reads is turns plus the agent's finished tasks, so clearing context
// deletes both. In-flight work (pending/claimed) is the queue rather than history and survives.
function deleteConversationHistory(db: DatabaseSync, agentId: string) {
  const has = (table: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  if (has("turns")) db.prepare("DELETE FROM turns WHERE agent_id=?").run(agentId);
  if (!has("tasks") || !hasColumn(db, "tasks", "creator")) return;
  const doomed = (db.prepare(
    `SELECT id FROM tasks WHERE (creator=? OR assignee=?) AND status IN ${TERMINAL}`,
  ).all(agentId, agentId) as Array<{ id: string }>).map((row) => row.id);
  if (!doomed.length) return;
  const list = doomed.map(() => "?").join(",");
  if (hasColumn(db, "tasks", "parent_id")) {
    db.prepare(`UPDATE tasks SET parent_id=NULL WHERE parent_id IN (${list})`).run(...doomed);
  }
  for (const table of ["task_context", "release_finalizations", "published_task_releases"]) {
    if (has(table)) db.prepare(`DELETE FROM ${table} WHERE task_id IN (${list})`).run(...doomed);
  }
  db.prepare(`DELETE FROM tasks WHERE id IN (${list})`).run(...doomed);
}

function hasColumn(db: DatabaseSync, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .some((row) => String(row.name) === column);
}
