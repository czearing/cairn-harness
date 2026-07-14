import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HealthIssue, HealthState } from "@/lib/types";
import { getProjects } from "./projects";

export function getHealth(): HealthState {
  const projects = getProjects();
  const issues = projects.flatMap(projectIssues);
  const active = projects.filter((project) => !project.paused);
  if (issues.length) return { status: "attention", label: `${issues.length} issue${issues.length === 1 ? "" : "s"}`, issues };
  if (!active.length && projects.length) return { status: "paused", label: "All projects paused", issues: [] };
  return { status: "healthy", label: "All systems operational", issues: [] };
}

function projectIssues(project: ReturnType<typeof getProjects>[number]): HealthIssue[] {
  if (project.paused) return [];
  const issues: HealthIssue[] = [];
  const recordPath = path.join(project.root, ".cairn-harness", "ui-worker.json");
  const record = readRecord(recordPath);
  if (!record || !alive(record.pid)) {
    issues.push(issue(project.id, project.name, "Agent worker is not running", `Expected worker record: ${recordPath}`));
  }
  const database = path.join(project.root, ".cairn-harness", "harness.db");
  if (!existsSync(database)) return issues;
  const db = new DatabaseSync(database, { readOnly: true });
  const latestSuccess = String((safeGet(db, "SELECT MAX(completed_at) value FROM turns WHERE status='completed'")?.value) || "");
  const failedAgents = safeAll(db, "SELECT agent_id,current_topic FROM agents WHERE status='failed'");
  const failures = safeAll(db, "SELECT recipient,topic,error,completed_at FROM messages WHERE status='failed' AND completed_at>? AND error!='incomplete agent output must send at least one message' ORDER BY completed_at DESC LIMIT 20", latestSuccess);
  const turns = safeAll(db, "SELECT agent_id,output_json,completed_at FROM turns WHERE status='failed' AND completed_at>? AND output_json NOT LIKE '%incomplete agent output must send at least one message%' ORDER BY completed_at DESC LIMIT 20", latestSuccess);
  db.close();
  if (failedAgents.length) {
    issues.push(issue(project.id, project.name, `${failedAgents.length} failed agent${failedAgents.length === 1 ? "" : "s"}`, failedAgents.map((row) => `${row.agent_id}: ${row.current_topic || "No active topic"}`).join("\n")));
  }
  if (failures.length || turns.length) {
    const transcript = [
      ...failures.map((row) => `[${row.completed_at || "unknown"}] message to ${row.recipient} (${row.topic})\n${row.error || "Unknown message failure"}`),
      ...turns.map((row) => `[${row.completed_at || "unknown"}] ${row.agent_id}\n${row.output_json || "Unknown turn failure"}`),
    ].join("\n\n");
    issues.push(issue(project.id, project.name, `${failures.length + turns.length} recorded failure${failures.length + turns.length === 1 ? "" : "s"}`, transcript));
  }
  return issues;
}

function issue(projectId: string, projectName: string, summary: string, transcript: string) {
  return { projectId, projectName, summary, transcript };
}
function readRecord(file: string): { pid: number } | null {
  try { return JSON.parse(readFileSync(file, "utf8")) as { pid: number }; } catch { return null; }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function safeAll(db: DatabaseSync, sql: string, ...values: string[]) {
  try { return db.prepare(sql).all(...values) as Record<string, unknown>[]; } catch { return []; }
}
function safeGet(db: DatabaseSync, sql: string) {
  try { return db.prepare(sql).get() as Record<string, unknown> | undefined; } catch { return undefined; }
}
