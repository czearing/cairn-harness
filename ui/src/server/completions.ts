import { existsSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "./sqlite.ts";
import type { CompletionEvent } from "../lib/completion-series.ts";

const COMPLETED_STATUSES = ["completed", "done", "released"];

// Root tasks are the unit an operator calls a work item. Delegations are how an agent breaks one up, so
// counting them as well would credit an agent once for the work and again for each way it subdivided it.
const COMPLETED_ROOT_WORK = `SELECT assignee,completed_at FROM tasks
  WHERE kind='root' AND completed_at IS NOT NULL
  AND status IN (${COMPLETED_STATUSES.map(() => "?").join(",")})
  ORDER BY completed_at`;

export function readCompletionEvents(root: string): CompletionEvent[] {
  const database = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(database)) return [];
  const db = openDatabase(database, { readOnly: true });
  try {
    return db.prepare(COMPLETED_ROOT_WORK).all(...COMPLETED_STATUSES)
      .filter((row) => row.assignee && row.completed_at)
      .map((row) => ({ agentId: String(row.assignee), completedAt: String(row.completed_at) }));
  } finally {
    db.close();
  }
}
