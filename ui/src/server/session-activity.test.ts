import assert from "node:assert/strict";
import test from "node:test";
import { projectToolActivity } from "./session-activity.ts";

test("projects SQL as safe planning activity without query text", () => {
  const activity = projectToolActivity("sql", {
    description: "Create bundle audit task",
    query: "INSERT INTO todos VALUES ('private implementation detail')",
  }, true);

  assert.equal(activity.title, "Used Planning");
  assert.equal(activity.body, "Create bundle audit task");
  assert.equal(activity.activity.target, "Create bundle audit task");
  assert.doesNotMatch(JSON.stringify(activity), /INSERT INTO|private implementation detail/);
});
