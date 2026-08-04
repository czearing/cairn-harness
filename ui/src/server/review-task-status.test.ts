import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { taskStatusPresentation } from "../lib/task-status.ts";
import { readSupersededReviewTaskIds } from "./review-task-status.ts";

test("completed retries project prior failed PR attempts as recovered", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE tasks (
      id TEXT,
      kind TEXT,
      body TEXT,
      status TEXT,
      assignee TEXT,
      created_at TEXT
    )`);
    const insert = db.prepare("INSERT INTO tasks VALUES (?, 'root', ?, ?, 'pr-reviewer', ?)");
    insert.run("failed-42", "Review Azure DevOps pull request #42: Fix", "failed", "2026-07-24T00:00:00Z");
    insert.run("completed-42", "Review Azure DevOps pull request #42: Fix", "completed", "2026-07-24T00:10:00Z");
    insert.run("failed-43", "Review Azure DevOps pull request #43: Other", "failed", "2026-07-24T00:20:00Z");

    assert.deepEqual([...readSupersededReviewTaskIds(db)], ["failed-42"]);
    assert.deepEqual(taskStatusPresentation("superseded"), {
      canonical: "completed",
      label: "Recovered",
      active: false,
      terminal: true,
      attention: false,
    });
  } finally {
    db.close();
  }
});
