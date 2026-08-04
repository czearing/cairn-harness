import type { DatabaseSync } from "node:sqlite";
import type { AgentStatus } from "@/lib/types";

export interface RecoverableRootWork {
  claimed: number;
  pending: number;
  waiting: number;
}

const noRecoverableRootWork: RecoverableRootWork = { claimed: 0, pending: 0, waiting: 0 };

export function readRecoverableRootWork(db: DatabaseSync): Map<string, RecoverableRootWork> {
  const rows = db.prepare(`
    SELECT
      assignee,
      SUM(CASE WHEN status='claimed' THEN 1 ELSE 0 END) AS claimed,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting
    FROM tasks
    WHERE kind='root' AND status IN ('claimed','pending','waiting')
    GROUP BY assignee
  `).all() as Record<string, unknown>[];
  return new Map(rows.map((row) => [String(row.assignee), {
    claimed: Number(row.claimed || 0),
    pending: Number(row.pending || 0),
    waiting: Number(row.waiting || 0),
  }]));
}

export function recoverableRootWorkFor(workByAgent: Map<string, RecoverableRootWork>, agentId: string) {
  return workByAgent.get(agentId) || noRecoverableRootWork;
}

export function projectAgentStatus(status: AgentStatus, work: RecoverableRootWork): AgentStatus {
  if (status !== "failed") return status;
  if (work.claimed > 0) return "working";
  if (work.pending > 0 || work.waiting > 0) return "idle";
  return "failed";
}
