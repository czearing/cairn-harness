import type { DatabaseSync } from "node:sqlite";

export function readSupersededReviewTaskIds(db: DatabaseSync) {
  const rows = db.prepare(`SELECT failed.id
    FROM tasks failed
    WHERE failed.kind='root'
      AND failed.status='failed'
      AND failed.body LIKE 'Review Azure DevOps pull request #%'
      AND EXISTS (
        SELECT 1
        FROM tasks newer
        WHERE newer.kind='root'
          AND newer.assignee=failed.assignee
          AND newer.status='completed'
          AND newer.created_at > failed.created_at
          AND newer.body LIKE 'Review Azure DevOps pull request #%'
          AND substr(newer.body,instr(newer.body,'#')+1,instr(newer.body,':')-instr(newer.body,'#')-1)
            = substr(failed.body,instr(failed.body,'#')+1,instr(failed.body,':')-instr(failed.body,'#')-1)
      )`).all() as { id: string }[];
  return new Set(rows.map((row) => row.id));
}
