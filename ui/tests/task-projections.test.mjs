import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readDelegatedActions, rootTaskItem } from "../src/server/task-projections.ts";

test("task projections preserve hierarchy ownership status and recency", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY,parent_id TEXT,kind TEXT,body TEXT,status TEXT,
    creator TEXT,assignee TEXT,topic TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT
  )`);
  const insert = db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  insert.run("root", null, "root", "Build the feature", "claimed", "product", "lead", "goal", "00", "01", null);
  insert.run("queued", "root", "delegation", "Queue work", "pending", "lead", "builder", "review", "02", null, null);
  insert.run("waiting", "root", "delegation", "Wait for input", "waiting", "lead", "reviewer", "review", "03", "04", null);
  insert.run("completed", "root", "delegation", "Finished work", "completed", "lead", "builder", "review", "05", "06", "07");
  insert.run("cancelled", "root", "delegation", "Dropped work", "cancelled", "lead", "builder", "review", "08", null, "09");
  insert.run("orphan", "missing-root", "delegation", "Visible orphan", "blocked", "lead", "", "review", "10", null, null);

  const actions = readDelegatedActions(db, false);
  assert.deepEqual(actions.map((action) => action.id), ["orphan", "cancelled", "completed", "waiting", "queued"]);
  assert.deepEqual(actions.find((action) => action.id === "waiting"), {
    id: "waiting",
    title: "Review",
    meta: "waiting",
    status: "waiting",
    rawStatus: "waiting",
    canonicalStatus: "waiting",
    statusLabel: "Waiting",
    taskKind: "delegation",
    parentId: "root",
    accountableId: "lead",
    executorId: "reviewer",
    content: "Wait for input",
    context: "For Build the feature",
    agentId: "reviewer",
    chatId: "task:waiting",
    updatedAt: "04",
  });
  assert.equal(actions.find((action) => action.id === "completed").updatedAt, "07");
  assert.equal(actions.find((action) => action.id === "orphan").context, "Missing parent missing-root");
  assert.equal(actions.find((action) => action.id === "orphan").executorId, undefined);

  const root = rootTaskItem({
    id: "root",
    kind: "root",
    body: "Build the feature",
    status: "claimed",
    creator: "product",
    assignee: "lead",
    created_at: "00",
    updated_at: "01",
  }, false);
  assert.equal(root.taskKind, "root");
  assert.equal(root.accountableId, "product");
  assert.equal(root.executorId, "lead");
  assert.equal(root.canonicalStatus, "running");
  assert.equal(root.statusLabel, "Running");
  assert.equal(root.updatedAt, "01");

  const paused = readDelegatedActions(db, true);
  assert.equal(paused.find((action) => action.id === "queued").status, "paused");
  assert.equal(paused.find((action) => action.id === "queued").rawStatus, "pending");
  assert.equal(paused.find((action) => action.id === "completed").status, "completed");
});
