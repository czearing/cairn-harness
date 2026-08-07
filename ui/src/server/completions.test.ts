import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCompletionEvents } from "./completions.ts";
import { completionSeries } from "../lib/completion-series.ts";

function workspace(seed: (db: DatabaseSync) => void): string {
  const root = mkdtempSync(path.join(tmpdir(), "harness-analytics-"));
  mkdirSync(path.join(root, ".cairn-harness"), { recursive: true });
  const db = new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"));
  db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,
    creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,
    error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT)`);
  seed(db);
  db.close();
  return root;
}

const insert = (db: DatabaseSync, id: string, kind: string, assignee: string, status: string, completedAt: string | null) =>
  db.prepare(`INSERT INTO tasks(id,kind,source,assignee,status,completed_at)
    VALUES(?,?,'manual',?,?,?)`).run(id, kind, assignee, status, completedAt);

test("a project without a database reports no completions instead of throwing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-analytics-none-"));
  try {
    assert.deepEqual(readCompletionEvents(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only finished root work counts, and every finished shape counts once", () => {
  const root = workspace((db) => {
    insert(db, "done", "root", "alice", "completed", "2026-08-01T12:00:00Z");
    insert(db, "released", "root", "alice", "released", "2026-08-02T12:00:00Z");
    insert(db, "legacy", "root", "alice", "done", "2026-08-03T12:00:00Z");
    insert(db, "running", "root", "alice", "claimed", null);
    insert(db, "failed", "root", "alice", "failed", "2026-08-04T12:00:00Z");
    insert(db, "cancelled", "root", "alice", "cancelled", "2026-08-04T12:00:00Z");
    insert(db, "subtask", "delegation", "alice", "completed", "2026-08-04T12:00:00Z");
    insert(db, "chat", "message", "alice", "completed", "2026-08-04T12:00:00Z");
    insert(db, "orphan", "root", "", "completed", "2026-08-05T12:00:00Z");
  });
  try {
    const events = readCompletionEvents(root);
    assert.deepEqual(events.map((event) => event.completedAt), [
      "2026-08-01T12:00:00Z", "2026-08-02T12:00:00Z", "2026-08-03T12:00:00Z",
    ]);
    assert.ok(events.every((event) => event.agentId === "alice"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("completions attribute to each agent and survive the trip into a series", () => {
  const root = workspace((db) => {
    insert(db, "a1", "root", "alice", "completed", "2026-08-01T12:00:00Z");
    insert(db, "a2", "root", "alice", "completed", "2026-08-03T12:00:00Z");
    insert(db, "b1", "root", "bob", "completed", "2026-08-02T12:00:00Z");
  });
  try {
    const series = completionSeries(readCompletionEvents(root), "UTC");
    assert.deepEqual(series.days, ["2026-08-01", "2026-08-02", "2026-08-03"]);
    assert.deepEqual(series.agents.map((agent) => [agent.agentId, agent.total]), [["alice", 2], ["bob", 1]]);
    assert.equal(series.total, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the analytics read never writes to the project database", () => {
  const root = workspace((db) => insert(db, "a1", "root", "alice", "completed", "2026-08-01T12:00:00Z"));
  try {
    readCompletionEvents(root);
    const db = new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"), { readOnly: true });
    const count = db.prepare("SELECT COUNT(*) count FROM tasks").get()?.count;
    db.close();
    assert.equal(count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
