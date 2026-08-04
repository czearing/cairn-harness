import assert from "node:assert/strict";
import test from "node:test";
import {
  supervisorEnabled,
  supervisorReconcileIntervalMs,
  supervisorRestartDelayMs,
} from "../src/server/supervisor-policy.ts";

test("project workers start by default", () => {
  assert.equal(supervisorEnabled({}), true);
});

test("project workers can be explicitly disabled", () => {
  assert.equal(supervisorEnabled({ HARNESS_ENABLE_SUPERVISOR: "0" }), false);
  assert.equal(supervisorEnabled({ HARNESS_DISABLE_SUPERVISOR: "1" }), false);
});

test("worker restart delay is configurable and rejects invalid values", () => {
  assert.equal(supervisorRestartDelayMs({}), 1_000);
  assert.equal(supervisorRestartDelayMs({ HARNESS_WORKER_RESTART_DELAY_MS: "250" }), 250);
  assert.equal(supervisorRestartDelayMs({ HARNESS_WORKER_RESTART_DELAY_MS: "-1" }), 1_000);
  assert.equal(supervisorRestartDelayMs({ HARNESS_WORKER_RESTART_DELAY_MS: "invalid" }), 1_000);
});

test("worker reconciliation interval is configurable and bounded", () => {
  assert.equal(supervisorReconcileIntervalMs({}), 1_000);
  assert.equal(supervisorReconcileIntervalMs({ HARNESS_WORKER_RECONCILE_INTERVAL_MS: "250" }), 250);
  assert.equal(supervisorReconcileIntervalMs({ HARNESS_WORKER_RECONCILE_INTERVAL_MS: "100" }), 1_000);
});
