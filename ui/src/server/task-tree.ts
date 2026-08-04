import type { DatabaseSync } from "node:sqlite";
import { promoteManualRootBacklog } from "./root-task-admission.ts";

const taskTree = `WITH RECURSIVE tree(id) AS (
  SELECT id FROM tasks WHERE id=? UNION
  SELECT child.id FROM tasks child JOIN tree ON child.parent_id=tree.id
)`;
const cancellableStatuses = "'pending','claimed','waiting','deferred','buffered','backlog'";

export function cancelTaskTree(db: DatabaseSync, taskId: string, completedAt: string) {
  const parent = db.prepare("SELECT parent_id FROM tasks WHERE id=?")
    .get(taskId) as { parent_id?: string } | undefined;
  const assignees = taskColumnExists(db, "assignee")
    ? db.prepare(`${taskTree} SELECT DISTINCT assignee FROM tasks WHERE id IN tree AND assignee IS NOT NULL`)
      .all(taskId) as { assignee: string }[]
    : [];
  const changes = db.prepare(`${taskTree} UPDATE tasks SET status='cancelled',claimed_at=NULL,completed_at=?
    WHERE id IN tree AND status IN (${cancellableStatuses})`).run(taskId, completedAt).changes;
  if (parent?.parent_id) {
    db.prepare(`UPDATE tasks SET status='pending',claimed_at=NULL
      WHERE id=? AND status='waiting'
      AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=tasks.id
        AND child.status IN (${cancellableStatuses}))`).run(parent.parent_id);
  }
  for (const { assignee } of assignees) promoteBufferedDelegation(db, assignee);
  promoteRootBacklog(db);
  return changes;
}

function promoteRootBacklog(db: DatabaseSync) {
  promoteManualRootBacklog(db);
}

function promoteBufferedDelegation(db: DatabaseSync, assignee: string) {
  db.prepare(`UPDATE tasks SET status='pending' WHERE id=(
    SELECT id FROM tasks WHERE assignee=? AND kind='delegation' AND source='agent'
    AND status='buffered' ORDER BY rowid LIMIT 1
  ) AND NOT EXISTS(
    SELECT 1 FROM tasks active WHERE active.assignee=?
    AND active.status IN ('pending','claimed','waiting','deferred')
  )`).run(assignee, assignee);
}

function taskColumnExists(db: DatabaseSync, column: string) {
  return (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[])
    .some((entry) => entry.name === column);
}

export function deleteTerminalTaskTree(db: DatabaseSync, taskId: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const task = db.prepare("SELECT status FROM tasks WHERE id=? AND kind='root'")
      .get(taskId) as { status: string } | undefined;
    if (!task) throw new Error("Task not found");
    if (!["cancelled", "completed", "failed"].includes(task.status)) {
      throw new Error("Cancel the task before deleting it");
    }
    const activeDescendant = db.prepare(`${taskTree} SELECT 1 FROM tasks
      WHERE id IN tree AND id<>?
      AND status IN ('pending','claimed','waiting','deferred','buffered','backlog') LIMIT 1`).get(taskId, taskId);
    if (activeDescendant) throw new Error("Cancel remaining work before deleting the task");
    const changes = db.prepare(`${taskTree} DELETE FROM tasks WHERE id IN tree`).run(taskId).changes;
    promoteManualRootBacklog(db);
    db.exec("COMMIT");
    return changes;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
