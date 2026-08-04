import assert from "node:assert/strict";
import test from "node:test";
import { taskStatusPresentation } from "../src/lib/task-status.ts";

test("task statuses retain distinct canonical presentations", () => {
  assert.deepEqual(taskStatusPresentation("pending"), {
    canonical: "queued", label: "Queued", active: true, terminal: false, attention: false,
  });
  assert.equal(taskStatusPresentation("claimed").canonical, "running");
  assert.equal(taskStatusPresentation("waiting").canonical, "waiting");
  assert.equal(taskStatusPresentation("blocked").canonical, "blocked");
  assert.equal(taskStatusPresentation("deferred").canonical, "paused");
  assert.equal(taskStatusPresentation("failed").canonical, "failed");
  assert.equal(taskStatusPresentation("completed").canonical, "completed");
  assert.equal(taskStatusPresentation("cancelled").canonical, "cancelled");
});

test("unknown task statuses fail visibly and safely", () => {
  assert.deepEqual(taskStatusPresentation("future-state"), {
    canonical: "unknown",
    label: "Unknown: future-state",
    active: false,
    terminal: false,
    attention: true,
  });
});
