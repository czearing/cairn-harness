import assert from "node:assert/strict";
import test from "node:test";
import {
  messageDeliveryState,
  messageStateLabel,
  persistedMessageState,
  submissionIdFromTask,
} from "../src/lib/message-lifecycle.ts";

test("message lifecycle exposes truthful durable transitions", () => {
  assert.equal(persistedMessageState("pending"), "queued");
  assert.equal(persistedMessageState("claimed"), "delivered");
  assert.equal(persistedMessageState("claimed", { status: "working", topic: "dashboard-message" }), "working");
  assert.equal(persistedMessageState("completed"), "replied");
  assert.equal(persistedMessageState("failed"), "failed");
  assert.equal(messageDeliveryState(message({ uiStatus: "sending" })), "sending");
  assert.equal(messageStateLabel(message({ deliveryState: "delivered" })), "Delivered to agent session");
});

test("persisted task IDs restore retry identity after refresh", () => {
  assert.equal(
    submissionIdFromTask("task:dashboard-message-project:submission"),
    "project:submission",
  );
  assert.equal(submissionIdFromTask("task:other"), undefined);
});

function message(overrides = {}) {
  return {
    id: "task:message",
    sender: "dashboard",
    recipient: "lead",
    body: "Follow up",
    status: "pending",
    timestamp: "2026-07-15T16:00:00.000Z",
    direction: "incoming",
    kind: "message",
    ...overrides,
  };
}
