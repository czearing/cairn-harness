import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
