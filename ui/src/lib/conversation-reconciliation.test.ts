import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "./types";
import { reconcileOptimisticMessages } from "./conversation-reconciliation.ts";

test("canonical completed messages remove queued optimistic overlays", () => {
  const optimistic = message({
    id: "optimistic:submission-1",
    submissionId: "submission-1",
    status: "pending",
    deliveryState: "queued",
  });
  const canonical = message({
    id: "task:dashboard-message-submission-1",
    submissionId: "submission-1",
    status: "completed",
    deliveryState: "replied",
  });
  const reply = message({
    id: "event:session:1",
    sender: "reviewer",
    kind: "assistant",
    status: "recorded",
    body: "The question was answered.",
  });

  const result = reconcileOptimisticMessages([canonical, reply], [optimistic]);

  assert.deepEqual(result.messages, [canonical, reply]);
  assert.deepEqual(result.unresolved, []);
});

test("only unresolved optimistic messages survive serial reconciliation", () => {
  const first = message({ id: "optimistic:one", submissionId: "one" });
  const second = message({ id: "optimistic:two", submissionId: "two", body: "Second question" });
  const canonicalFirst = message({
    id: "task:dashboard-message-one",
    submissionId: "one",
    status: "claimed",
    deliveryState: "working",
  });

  const result = reconcileOptimisticMessages([canonicalFirst], [first, second]);

  assert.deepEqual(result.messages, [canonicalFirst, second]);
  assert.deepEqual(result.unresolved, [second]);
});

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message",
    sender: "dashboard",
    recipient: "reviewer",
    body: "Question",
    status: "pending",
    timestamp: "2026-07-28T21:59:16.025Z",
    direction: "incoming",
    kind: "message",
    ...overrides,
  };
}
