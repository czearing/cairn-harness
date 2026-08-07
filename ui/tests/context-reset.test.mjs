import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { resetAgentContext } from "../src/server/context-reset.ts";

test("clear context requeues claimed work immediately", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-context-"));
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agents(
    agent_id TEXT PRIMARY KEY,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT
  );
  CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT,status TEXT,claimed_at TEXT);`);
  db.prepare("INSERT INTO agents VALUES(?,?,?,?,?)").run("author", "session", "working", "poem", "before");
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?)").run("opaque:task", "author", "claimed", "before");

  resetAgentContext(db, root, "author", "after");

  assert.deepEqual([...db.prepare("SELECT session_id,status,current_topic FROM agents").all()]
    .map((row) => [row.session_id, row.status, row.current_topic]), [["", "idle", null]]);
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='opaque:task'").get().status, "pending");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 1);
});

test("clear context records the watermark the agent replays turns against", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-context-"));
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agents(
    agent_id TEXT PRIMARY KEY,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT
  );
  CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT,status TEXT,claimed_at TEXT);`);
  db.prepare("INSERT INTO agents VALUES(?,?,?,?,?)").run("author", "session", "working", "poem", "before");

  resetAgentContext(db, root, "author", "2026-08-07T00:00:00.000Z");

  assert.deepEqual(db.prepare("SELECT agent_id,cleared_at FROM context_resets").all()
    .map((row) => [row.agent_id, row.cleared_at]), [["author", "2026-08-07T00:00:00.000Z"]]);

  resetAgentContext(db, root, "author", "2026-08-08T00:00:00.000Z");

  assert.deepEqual(db.prepare("SELECT agent_id,cleared_at FROM context_resets").all()
    .map((row) => [row.agent_id, row.cleared_at]), [["author", "2026-08-08T00:00:00.000Z"]],
  "a later reset replaces the watermark instead of adding a second row");
});

test("clear context deletes the session logs the chat is rendered from", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-context-"));
  const logs = path.join(root, ".cairn-harness", "copilot-home", "author", "session-state", "session-1");
  mkdirSync(logs, { recursive: true });
  writeFileSync(path.join(logs, "events.jsonl"), "{\"timestamp\":\"2026-01-01T00:00:00Z\"}\n");
  const keep = path.join(root, ".cairn-harness", "copilot-home", "editor", "session-state", "session-2");
  mkdirSync(keep, { recursive: true });
  writeFileSync(path.join(keep, "events.jsonl"), "{\"timestamp\":\"2026-01-01T00:00:00Z\"}\n");

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agents(
    agent_id TEXT PRIMARY KEY,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT
  );
  CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT,status TEXT,claimed_at TEXT);`);
  db.prepare("INSERT INTO agents VALUES(?,?,?,?,?)").run("author", "session", "idle", null, "before");

  resetAgentContext(db, root, "author", "2026-08-07T00:00:00.000Z");

  assert.equal(existsSync(path.join(root, ".cairn-harness", "copilot-home", "author", "session-state")), false,
    "the agent's Copilot session logs are the transcript the chat renders and must be deleted");
  assert.equal(existsSync(keep), true, "another agent's session logs are untouched");
});

test("clear context deletes the conversation history but keeps unfinished work", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-context-"));
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agents(
    agent_id TEXT PRIMARY KEY,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT
  );
  CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,creator TEXT,assignee TEXT,status TEXT,claimed_at TEXT);
  CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,completed_at TEXT);
  CREATE TABLE task_context(id TEXT PRIMARY KEY,task_id TEXT);`);
  db.prepare("INSERT INTO agents VALUES(?,?,?,?,?)").run("author", "session", "idle", null, "before");
  const task = db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?)");
  task.run("done", null, "dashboard", "author", "completed", null);
  task.run("sent", null, "author", "editor", "completed", null);
  task.run("queued", null, "dashboard", "author", "pending", null);
  task.run("other", null, "dashboard", "editor", "completed", null);
  task.run("child", "done", "dashboard", "editor", "pending", null);
  db.prepare("INSERT INTO turns VALUES(?,?,?)").run(1, "author", "before");
  db.prepare("INSERT INTO turns VALUES(?,?,?)").run(2, "editor", "before");
  db.prepare("INSERT INTO task_context VALUES(?,?)").run("ctx", "done");

  resetAgentContext(db, root, "author", "2026-08-07T00:00:00.000Z");

  assert.deepEqual(db.prepare("SELECT id FROM tasks ORDER BY id").all().map((row) => row.id),
    ["child", "other", "queued"],
    "the agent's finished conversation is deleted while unfinished work and other agents survive");
  assert.deepEqual(db.prepare("SELECT sequence FROM turns").all().map((row) => row.sequence), [2],
    "only this agent's turns are deleted");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM task_context").get().count, 0,
    "rows depending on a deleted task are removed with it");
  assert.equal(db.prepare("SELECT parent_id FROM tasks WHERE id='child'").get().parent_id, null,
    "a surviving child does not keep pointing at a deleted parent");
});
