import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { persistTaskSubmission } from "./task-submission.ts";

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "harness-submission-"));
  mkdirSync(path.join(root, ".cairn-harness"), { recursive: true });
  const db = new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"));
  db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,kind TEXT,source TEXT,creator TEXT,
    assignee TEXT,topic TEXT,body TEXT,status TEXT,error TEXT,claimed_at TEXT,completed_at TEXT,created_at TEXT);
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,status TEXT);
    INSERT INTO agents VALUES('reviewer','working');`);
  db.close();
  return root;
}

function submit(root: string, body: string, topic: "dashboard-message" | "work-item") {
  return persistTaskSubmission({
    projectId: "demo",
    root,
    paused: true,
    kind: "message",
    source: "message",
    assignee: "reviewer",
    topic,
    body,
    submissionId: "demo:one",
  }, () => false);
}

// The Rust worker only cancels an in-flight turn when the pending task carries runtime context, so
// an operator message that records none waits for the whole turn to finish.
function interruptsWorkingAgent(root: string, taskId: string) {
  const db = new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"));
  db.exec("CREATE TABLE IF NOT EXISTS task_context(id TEXT PRIMARY KEY,task_id TEXT NOT NULL)");
  const row = db.prepare(`SELECT COUNT(*) AS count FROM tasks
    JOIN agents ON agents.agent_id=tasks.assignee
    WHERE tasks.id=? AND tasks.status='pending' AND tasks.claimed_at IS NULL
    AND agents.status='working'
    AND EXISTS(SELECT 1 FROM task_context WHERE task_context.task_id=tasks.id)`).get(taskId) as { count: number };
  db.close();
  return row.count > 0;
}

test("an operator message preempts an agent that is mid-turn", () => {
  const root = project();
  const result = submit(root, "Stop and answer me", "dashboard-message");
  assert.equal(interruptsWorkingAgent(root, result.id), true);
});

test("the priority note does not repeat the message body", () => {
  const root = project();
  const result = submit(root, "Stop and answer me", "dashboard-message");
  const db = new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"));
  const rows = db.prepare("SELECT body FROM task_context WHERE task_id=?").all(result.id) as { body: string }[];
  db.close();
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].body.includes("Stop and answer me"));
});

test("resubmitting the same message keeps a single priority note", () => {
  const root = project();
  const result = submit(root, "Stop and answer me", "dashboard-message");
  submit(root, "Stop and answer me", "dashboard-message");
  const db = new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"));
  const rows = db.prepare("SELECT id FROM task_context WHERE task_id=?").all(result.id) as { id: string }[];
  db.close();
  assert.equal(rows.length, 1);
});

test("background work items do not preempt a working agent", () => {
  const root = project();
  const result = submit(root, "Refactor the parser", "work-item");
  assert.equal(interruptsWorkingAgent(root, result.id), false);
});
