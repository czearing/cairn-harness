import assert from "node:assert/strict";
import test from "node:test";
import { automationWarning, putAutomation } from "../src/components/Dashboard/dashboard-requests.ts";

test("persisted automation restart failures return a page-level warning result", async () => {
  const result = await putAutomation("/automation", {}, async () =>
    Response.json({ error: "worker restart failed", persisted: true }, { status: 503 }));

  assert.deepEqual(result, { persisted: true, workerError: "worker restart failed" });
  assert.equal(
    automationWarning(result),
    "Automation settings saved, but agents did not restart. worker restart failed Open system status to restart agents.",
  );
});

test("automation request failures reject with the API message", async () => {
  await assert.rejects(
    putAutomation("/automation", {}, async () =>
      Response.json({ error: "config write failed" }, { status: 400 })),
    /config write failed/,
  );
});
