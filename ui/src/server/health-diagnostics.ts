import type { DatabaseSync } from "node:sqlite";

export function readRecentTaskFailures(db: DatabaseSync, workerStartedAt: string) {
  return db.prepare(`SELECT assignee recipient,topic,error,completed_at
      FROM tasks
      WHERE status='failed' AND completed_at>?
      ORDER BY completed_at DESC`)
    .all(workerStartedAt) as Record<string, unknown>[];
}
