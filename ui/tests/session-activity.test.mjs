import assert from "node:assert/strict";
import test from "node:test";
import { projectToolActivity } from "../src/server/session-activity.ts";

test("safe activity exposes bounded execution metadata without raw results", () => {
  assert.deepEqual(
    projectToolActivity("functions.view", { path: "C:\\repo\\src\\app.ts" }, false),
    {
      title: "Using View",
      body: "Target: C:\\repo\\src\\app.ts",
      status: "working",
      activity: { phase: "Working", tool: "View", target: "C:\\repo\\src\\app.ts" },
    },
  );
  const command = projectToolActivity(
    "functions.powershell",
    { command: "deploy --token=secret-value --password hunter2" },
    false,
  );
  assert.equal(command.activity.command, "deploy --token=[redacted] --password [redacted]");
  assert.doesNotMatch(JSON.stringify(command), /secret-value|hunter2/);

  const redactions = [
    ['deploy --token="quoted multiword secret" --mode safe', "deploy --token=[redacted] --mode safe"],
    ["deploy --password 'two word value' --dry-run", "deploy --password [redacted] --dry-run"],
    ["deploy API_KEY=equals-value --region west", "deploy API_KEY=[redacted] --region west"],
    ["deploy --client-secret separated-value --verbose", "deploy --client-secret [redacted] --verbose"],
    ["deploy --credential \"separated multiword value\" --verbose", "deploy --credential [redacted] --verbose"],
    ["curl -H 'Authorization: Bearer bearer-value' /health", "curl -H 'Authorization: Bearer [redacted]' /health"],
  ];
  for (const [input, expected] of redactions) {
    const projected = projectToolActivity("functions.powershell", { command: input }, false);
    assert.equal(projected.activity.command, expected);
  }
  assert.equal(
    projectToolActivity("functions.powershell", { command: "npm test -- --grep messaging" }, false).activity.command,
    "npm test -- --grep messaging",
  );
  assert.equal(
    projectToolActivity("cairn-brain_search", { query: "How should leader chat behave?" }, false).activity.target,
    "How should leader chat behave?",
  );

  const complete = projectToolActivity("functions.view", { result: "private output" }, true);
  assert.equal(complete.body, "Completed View");
  assert.doesNotMatch(JSON.stringify(complete), /private output/);
});
