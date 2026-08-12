import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { dashboardTaskId, selectTaskRows } from "./task-rows.ts";

function seeded() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks (
    id TEXT, assignee TEXT, result TEXT, status TEXT, attempts INTEGER,
    error TEXT, created_at TEXT, completed_at TEXT
  )`);
  const insert = db.prepare(
    "INSERT INTO tasks(id,assignee,result,status,attempts,error,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  insert.run("dashboard-message-sub-a", "perf", "No measurable gain.", "completed", 1, null,
    "2026-08-12T20:46:46Z", "2026-08-12T20:57:07Z");
  insert.run("dashboard-message-sub-b", "perf", null, "pending", 0, null, "2026-08-12T20:55:54Z", null);
  insert.run("dashboard-message-sub-c", "perf", null, "failed", 3,
    "required Cairn Copilot hook is unavailable", "2026-08-12T18:00:00Z", "2026-08-12T18:05:00Z");
  return db;
}

test("a submitter can address the exact row its submission created", () => {
  // The submitter holds a submission id, not a task id. If the harness does not own that
  // mapping, every client reimplements it and a drift reads as "no such task".
  assert.equal(dashboardTaskId("sub-a"), "dashboard-message-sub-a");
});

test("each task reports its own result rather than a shared agent message", () => {
  const db = seeded();
  try {
    const byId = Object.fromEntries(
      selectTaskRows(db, ["dashboard-message-sub-a", "dashboard-message-sub-b"]).map((row) => [row.id, row]),
    );
    assert.equal(byId["dashboard-message-sub-a"].status, "completed");
    assert.equal(byId["dashboard-message-sub-a"].result, "No measurable gain.");
    assert.equal(byId["dashboard-message-sub-a"].completedAt, "2026-08-12T20:57:07Z");
    // One finished while the other is still queued: the distinction agent status cannot make.
    assert.equal(byId["dashboard-message-sub-b"].status, "pending");
    assert.equal(byId["dashboard-message-sub-b"].completedAt, null);
  } finally {
    db.close();
  }
});

test("a failed task is reported as failed with its error, not as a completion", () => {
  // A caller that cannot tell these apart retires real work whenever a turn merely crashed.
  const db = seeded();
  try {
    const [row] = selectTaskRows(db, ["dashboard-message-sub-c"]);
    assert.equal(row.status, "failed");
    assert.equal(row.error, "required Cairn Copilot hook is unavailable");
    assert.equal(row.attempts, 3);
  } finally {
    db.close();
  }
});

test("an unknown id is omitted rather than reported as a task", () => {
  const db = seeded();
  try {
    assert.deepEqual(selectTaskRows(db, ["dashboard-message-missing"]), []);
  } finally {
    db.close();
  }
});

test("ids are bound as parameters, so a quote in an id cannot alter the query", () => {
  const db = seeded();
  try {
    assert.deepEqual(selectTaskRows(db, ["' OR 1=1 --"]), []);
  } finally {
    db.close();
  }
});

test("no ids means no query", () => {
  const db = seeded();
  try {
    assert.deepEqual(selectTaskRows(db, []), []);
  } finally {
    db.close();
  }
});
