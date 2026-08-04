import { rmSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export function resetAgentContext(db: DatabaseSync, root: string, agentId: string, clearedAt: string) {
  const result = db.prepare("UPDATE agents SET session_id='',status='idle',current_topic=NULL,updated_at=? WHERE agent_id=?")
    .run(clearedAt, agentId);
  if (!result.changes) throw new Error("Agent not found");
  db.prepare("UPDATE tasks SET status='pending',claimed_at=NULL WHERE assignee=? AND status='claimed'")
    .run(agentId);
  rmSync(path.join(root, ".cairn-harness", "ui-session-cache", agentId), { recursive: true, force: true });
}
