import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import type { HealthIssue, HealthState } from "@/lib/types";
import { projectAgentStatus, readRecoverableRootWork, recoverableRootWorkFor } from "./agent-status-projection";
import { readTextTail } from "./file-tail";
import { readRecentTaskFailures } from "./health-diagnostics";
import { getProjectConfigPath, getProjectListing, type ProjectReadDiagnostic } from "./projects";
import { cachedHealth, healthInputSignature, storeHealth } from "./health-snapshot";
import { createCachedWorkerProcessResolver } from "./worker-process-identity";

const resolveWorkerProcess = createCachedWorkerProcessResolver();

export function getHealth(): HealthState {
  const { projects, diagnostics } = getProjectListing();
  const signature = healthInputSignature(projects.map(({ id, root }) => ({ id, root })));
  const reusable = cachedHealth(signature);
  if (reusable) return reusable;
  const state = readHealth(projects, diagnostics);
  storeHealth(signature, state);
  return state;
}

function readHealth(
  projects: ReturnType<typeof getProjectListing>["projects"],
  diagnostics: ProjectReadDiagnostic[],
): HealthState {
  const issues = [...diagnostics.map(projectRegistrationIssue), ...projects.flatMap(projectIssues)];
  const active = projects.filter((project) => !project.paused);
  if (issues.length) return { status: "attention", label: `${issues.length} issue${issues.length === 1 ? "" : "s"}`, issues };
  if (!active.length && projects.length) return { status: "paused", label: "All projects paused", issues: [] };
  return { status: "healthy", label: "All systems operational", issues: [] };
}

function projectRegistrationIssue(diagnostic: ProjectReadDiagnostic): HealthIssue {
  const projectId = path.basename(path.dirname(diagnostic.configPath));
  return issue(
    projectId,
    projectId,
    "Project registration is invalid",
    `Could not read project registration ${diagnostic.configPath}.\n${diagnostic.error}`,
  );
}

function projectIssues(project: ReturnType<typeof getProjectListing>["projects"][number]): HealthIssue[] {
  if (project.paused) return [];
  if (!project.agents.length) return [];
  const issues: HealthIssue[] = [];
  const recordPath = path.join(project.root, ".cairn-harness", "ui-worker.json");
  const record = readRecord(recordPath);
  const config = getProjectConfigPath(project.id);
  const worker = config ? resolveWorkerProcess(record, config) || undefined : undefined;
  if (!worker) {
    const logPath = path.join(project.root, ".cairn-harness", "worker.log");
    const recentLog = readTextTail(logPath, 4000);
    issues.push(issue(
      project.id,
      project.name,
      "Agent worker is not running",
      [`Expected worker record: ${recordPath}`, recentLog && `Recent worker log:\n${recentLog}`].filter(Boolean).join("\n\n"),
    ));
  }
  const database = path.join(project.root, ".cairn-harness", "harness.db");
  if (!existsSync(database)) return issues;
  let db: DatabaseSync;
  try {
    db = openDatabase(database, { readOnly: true });
  } catch (error) {
    issues.push(databaseDiagnosticIssue(project.id, project.name, database, error));
    return issues;
  }
  let diagnostics: ReturnType<typeof readDatabaseDiagnostics> | undefined;
  let diagnosticError: unknown;
  try {
    diagnostics = readDatabaseDiagnostics(db, worker?.startedAt || "");
  } catch (error) {
    diagnosticError = error;
  } finally {
    try { db.close(); } catch (error) { diagnosticError ||= error; }
  }
  if (diagnosticError || !diagnostics) {
    issues.push(databaseDiagnosticIssue(project.id, project.name, database, diagnosticError));
    return issues;
  }
  const { failedAgents, failures, turns, suspicious } = diagnostics;
  if (failedAgents.length) {
    issues.push(issue(project.id, project.name, `${failedAgents.length} failed agent${failedAgents.length === 1 ? "" : "s"}`, failedAgents.map((row) => `${row.agent_id}: ${row.current_topic || row.last_error || "No active topic"}`).join("\n")));
  }
  if (failures.length || turns.length) {
    const transcript = [
      ...failures.map((row) => `[${row.completed_at || "unknown"}] message to ${row.recipient} (${row.topic})\n${row.error || "Unknown message failure"}`),
      ...turns.map((row) => `[${row.completed_at || "unknown"}] ${row.agent_id}\n${row.output_json || "Unknown turn failure"}`),
    ].join("\n\n");
    issues.push(issue(project.id, project.name, `${failures.length + turns.length} recorded failure${failures.length + turns.length === 1 ? "" : "s"}`, transcript));
  }
  if (suspicious.length) {
    issues.push(issue(
      project.id,
      project.name,
      `${suspicious.length} suspicious waiting turn${suspicious.length === 1 ? "" : "s"}`,
      suspicious.map((row) => `[${row.completed_at || "unknown"}] ${row.agent_id}\n${row.output_json}`).join("\n\n"),
    ));
  }
  return issues;
}

function issue(projectId: string, projectName: string, summary: string, transcript: string) {
  return { projectId, projectName, summary, transcript };
}
function readRecord(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")) as unknown; } catch { return null; }
}

function readDatabaseDiagnostics(db: DatabaseSync, workerStartedAt: string) {
  const recoverableRootWork = readRecoverableRootWork(db);
  const failedAgents = (db.prepare(`SELECT agent_id,current_topic,
      (SELECT error FROM tasks WHERE assignee=agents.agent_id AND status='failed'
        ORDER BY completed_at DESC,id DESC LIMIT 1) last_error
      FROM agents WHERE status='failed'`)
    .all() as Record<string, unknown>[]).filter((agent) => projectAgentStatus(
      "failed",
      recoverableRootWorkFor(recoverableRootWork, String(agent.agent_id)),
    ) === "failed");
  const failures = readRecentTaskFailures(db, workerStartedAt);
  const turns = db.prepare("SELECT turn.agent_id,turn.output_json,turn.completed_at FROM turns turn JOIN tasks task ON task.id=turn.message_id WHERE turn.status='failed' AND turn.completed_at>? AND turn.output_json NOT LIKE '%incomplete agent output must send at least one message%' ORDER BY turn.completed_at DESC")
    .all(workerStartedAt) as Record<string, unknown>[];
  const suspicious = db.prepare("SELECT agent_id,output_json,completed_at FROM turns WHERE status='waiting' AND completed_at>? AND lower(output_json) LIKE '%empty agent output%' ORDER BY completed_at DESC LIMIT 20")
    .all(workerStartedAt) as Record<string, unknown>[];
  return { failedAgents, failures, turns, suspicious };
}

function databaseDiagnosticIssue(projectId: string, projectName: string, database: string, error: unknown) {
  return issue(
    projectId,
    projectName,
    "Project database diagnostics are unavailable",
    `Could not read required health diagnostics from ${database}.\n${errorDetail(error)}`,
  );
}

function errorDetail(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error || "Unknown database error");
}

