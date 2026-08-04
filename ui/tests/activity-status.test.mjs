import assert from "node:assert/strict";
import test from "node:test";

const { activityStatusPresentation } = await import("../src/lib/activity-status.ts");

test("recoverable retry activity is not presented as failed", () => {
  assert.deepEqual(activityStatusPresentation("retrying"), {
    failed: false,
    label: "Retrying",
    kind: "retrying",
  });
  assert.equal(activityStatusPresentation("failed").failed, true);
});
