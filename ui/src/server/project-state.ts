import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import { ensureOperatorPauseTable } from "./agent-pause-state";
import { withSqliteRetry } from "./sqlite-retry";

export function setProjectState(
  configPath: string,
  status: "paused" | "idle",
  requeue: boolean,
) {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { root: string };
  const root = path.resolve(path.dirname(configPath), config.root);
  const database = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(database)) return;
  withSqliteRetry(() => {
    const db = openDatabase(database);
    try {
      setProjectStateInDatabase(db, status, requeue);
    } finally {
      db.close();
    }
  });
}

export function setProjectStateInDatabase(
  db: DatabaseSync,
  status: "paused" | "idle",
  requeue: boolean,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureOperatorPauseTable(db);
    if (requeue) db.exec("UPDATE tasks SET status='pending',claimed_at=NULL WHERE status='claimed'");
    const now = new Date().toISOString();
    if (status === "paused") {
      db.prepare("UPDATE agents SET status='paused',current_topic=NULL,updated_at=?").run(now);
    } else {
      db.prepare(`UPDATE agents SET status=CASE
        WHEN agent_id IN (SELECT agent_id FROM operator_pauses) THEN 'paused'
        ELSE 'idle' END,current_topic=NULL,updated_at=?`).run(now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

