import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";

export interface TaskRow {
  id: string;
  status: string;
  attempts: number;
  error: string | null;
  result: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

/**
 * The dashboard derives a task id from the submission id it was handed, so a caller that
 * submitted work can address the exact row it created instead of guessing at one. Owning the
 * mapping here keeps every client from reimplementing it and drifting silently.
 */
export function dashboardTaskId(submissionId: string) {
  return `dashboard-message-${submissionId}`;
}

/**
 * Read the exact state of specific tasks.
 *
 * A submitter that can only see agent-level status cannot tell which of several in-flight tasks
 * a sign-off belongs to, cannot distinguish a task that failed from one that finished, and
 * cannot notice a finished task until the agent stops working on everything else. Each of those
 * is a wrong answer to a question this row already answers exactly.
 *
 * Unknown ids are omitted rather than reported as missing, because a caller polling a set of ids
 * should not have to distinguish "not inserted yet" from "not mine".
 */
export function selectTaskRows(db: DatabaseSync, ids: string[]): TaskRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id,status,attempts,error,result,created_at,completed_at
       FROM tasks WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    status: String(row.status || ""),
    attempts: Number(row.attempts || 0),
    error: text(row.error),
    result: text(row.result),
    createdAt: text(row.created_at),
    completedAt: text(row.completed_at),
  }));
}

/** Open the project's database read-only and read the rows. */
export function readTaskRows(root: string, ids: string[]): TaskRow[] {
  if (ids.length === 0) return [];
  const db = openDatabase(path.join(root, ".cairn-harness", "harness.db"), { readOnly: true });
  try {
    return selectTaskRows(db, ids);
  } finally {
    db.close();
  }
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
