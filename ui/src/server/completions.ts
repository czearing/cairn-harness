import { existsSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "./sqlite.ts";
import type { CompletionEvent } from "../lib/completion-series.ts";

const COMPLETED_STATUSES = ["completed", "done", "released"];

// Every completed task counts once for the agent that finished it, whether it arrived as a root work
// item, a delegation from another agent, or a direct message. The one exclusion is a task an agent
// created by subdividing its own assignment, which would otherwise credit that agent once for the work
// and again for each way it chose to break it up.
const COMPLETED_WORK = `SELECT task.assignee,task.completed_at FROM tasks task
  WHERE task.completed_at IS NOT NULL
  AND task.status IN (${COMPLETED_STATUSES.map(() => "?").join(",")})
  AND NOT EXISTS (
    SELECT 1 FROM tasks parent
    WHERE parent.id=task.parent_id AND parent.assignee=task.assignee
  )
  ORDER BY task.completed_at`;

export function readCompletionEvents(root: string): CompletionEvent[] {
  const database = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(database)) return [];
  const db = openDatabase(database, { readOnly: true });
  try {
    return db.prepare(COMPLETED_WORK).all(...COMPLETED_STATUSES)
      .filter((row) => row.assignee && row.completed_at)
      .map((row) => ({ agentId: String(row.assignee), completedAt: String(row.completed_at) }));
  } finally {
    db.close();
  }
}
