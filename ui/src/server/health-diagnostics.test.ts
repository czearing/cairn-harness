import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readRecentTaskFailures } from "./health-diagnostics.ts";

test("health excludes task failures from before the current worker start", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE tasks (
      assignee TEXT,
      topic TEXT,
      error TEXT,
      completed_at TEXT,
      status TEXT
    )`);
    const insert = db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, 'failed')");
    insert.run("reviewer", "old", "historical", "2026-07-24T05:05:03Z");
    insert.run("reviewer", "current", "current failure", "2026-07-24T20:05:03Z");

    const failures = readRecentTaskFailures(db, "2026-07-24T19:29:09Z");
    assert.deepEqual(failures.map((failure) => failure.topic), ["current"]);
  } finally {
    db.close();
  }
});
