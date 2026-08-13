import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import { admitDashboardRoot } from "./root-task-admission.ts";

export interface TaskSubmissionResult {
  id: string;
  status: string;
  workerStarted: boolean;
  workerError?: string;
}
export class TaskSubmissionConflictError extends Error {}

interface TaskSubmission {
  projectId: string;
  root: string;
  paused: boolean;
  kind: "message" | "root";
  source: "message" | "manual";
  assignee: string;
  topic: "dashboard-message" | "work-item";
  body: string;
  submissionId?: string;
}

interface TaskPersistenceDependencies {
  createId: () => string;
  now: () => string;
}

const defaultDependencies: TaskPersistenceDependencies = {
  createId: randomUUID,
  now: () => new Date().toISOString(),
};

export function persistTaskSubmission(
  submission: TaskSubmission,
  startWorker: (projectId: string) => boolean,
  dependencies: TaskPersistenceDependencies = defaultDependencies,
): TaskSubmissionResult {
  const taskId = submission.topic === "dashboard-message"
    ? dashboardMessageTaskId(submission, dependencies.createId)
    : dependencies.createId();
  const db = openDatabase(path.join(submission.root, ".cairn-harness", "harness.db"));
  let created = true;
  let retrying = false;
  let status = "pending";
  try {
    if (submission.kind === "root" && submission.source === "manual" && submission.topic === "work-item") {
      created = admitDashboardRoot(db, {
        id: taskId,
        assignee: submission.assignee,
        topic: submission.topic,
        body: submission.body,
        createdAt: dependencies.now(),
      }).created;
    } else {
      const result = db.prepare(`INSERT INTO tasks(id,kind,source,creator,assignee,topic,body,status,created_at)
        VALUES(?,?,?,'dashboard',?,?,?,'pending',?) ON CONFLICT(id) DO NOTHING`).run(
        taskId,
        submission.kind,
        submission.source,
        submission.assignee,
        submission.topic,
        submission.body,
        dependencies.now(),
      );
      created = result.changes === 1;
      validateDashboardMessage(db, taskId, submission);
      if (submission.topic === "dashboard-message") {
        markOperatorPriority(db, taskId, dependencies.now());
      }
      if (!created) {
        const retry = db.prepare(`UPDATE tasks
          SET status='pending',error=NULL,claimed_at=NULL,completed_at=NULL
          WHERE id=? AND status='failed'`).run(taskId);
        retrying = retry.changes === 1;
      }
    }
    status = String((db.prepare("SELECT status FROM tasks WHERE id=?").get(taskId) as { status?: string } | undefined)?.status || "pending");
  } finally {
    db.close();
  }

  if (!created && !retrying) return { id: taskId, status, workerStarted: false };
  if (submission.paused) return { id: taskId, status, workerStarted: false };
  try {
    const workerStarted = startWorker(submission.projectId);
    return workerStarted
      ? { id: taskId, status, workerStarted: true }
      : { id: taskId, status, workerStarted: false, workerError: "Project worker did not start" };
  } catch (error) {
    return {
      id: taskId,
      status,
      workerStarted: false,
      workerError: error instanceof Error ? error.message : "Project worker did not start",
    };
  }
}

function dashboardMessageTaskId(submission: TaskSubmission, createId: () => string) {
  const prefix = `${encodeURIComponent(submission.projectId)}:`;
  const submissionId = submission.submissionId || `${prefix}${createId()}`;
  if (!submissionId.startsWith(prefix) || submissionId.length === prefix.length || submissionId.length > 240) {
    throw new TaskSubmissionConflictError("Message submission ID does not belong to this project");
  }
  return `dashboard-message-${submissionId}`;
}

// A pending task only preempts a working agent when it carries runtime context, so operator
// messages record a priority note. Without it a chat message waits for the whole in-flight turn.
function markOperatorPriority(db: DatabaseSync, taskId: string, createdAt: string) {
  db.exec(`CREATE TABLE IF NOT EXISTS task_context (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    creator TEXT NOT NULL,
    topic TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.prepare(`INSERT INTO task_context(id,task_id,creator,topic,body,created_at)
    VALUES(?,?,'dashboard','operator-priority',?,?) ON CONFLICT(id) DO NOTHING`).run(
    `operator-priority:${taskId}`,
    taskId,
    "An operator is waiting in chat. Answer this message before resuming other work.",
    createdAt,
  );
}

function validateDashboardMessage(db: DatabaseSync, taskId: string, submission: TaskSubmission) {  const existing = db.prepare("SELECT kind,source,creator,assignee,topic,body FROM tasks WHERE id=?").get(taskId) as {
    kind: string; source: string; creator: string; assignee: string; topic: string; body: string;
  } | undefined;
  if (!existing
    || existing.kind !== submission.kind
    || existing.source !== submission.source
    || existing.creator !== "dashboard"
    || existing.assignee !== submission.assignee
    || existing.topic !== submission.topic
    || existing.body !== submission.body) {
    throw new TaskSubmissionConflictError("Message submission conflicts with an existing task");
  }
}

export function submissionSuccess(result: TaskSubmissionResult, includeTask = false) {
  const { id, status, ...worker } = result;
  return includeTask ? { ok: true as const, id, status, ...worker } : { ok: true as const, ...worker };
}

