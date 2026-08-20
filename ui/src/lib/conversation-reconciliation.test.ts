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

test("an acknowledged message that scrolled out of the page window does not resurface", () => {
  // The conversation is paged, so a message the user sent earlier can fall outside the newest
  // page while its optimistic overlay is still held. Splicing that overlay back in by timestamp
  // put the user's own message back at the top of the window as if it had just been resent.
  const sent = message({
    id: "task:dashboard-message-old",
    submissionId: "old",
    timestamp: "2026-07-28T21:00:00.000Z",
    deliveryState: "queued",
  });
  const window = [
    message({ id: "event:session:9", sender: "reviewer", kind: "assistant", timestamp: "2026-07-28T22:00:00.000Z" }),
    message({ id: "event:session:10", sender: "reviewer", kind: "assistant", timestamp: "2026-07-28T22:00:01.000Z" }),
  ];

  const result = reconcileOptimisticMessages(window, [sent]);

  assert.deepEqual(result.messages, window);
  assert.deepEqual(result.unresolved, []);
});

test("a message still awaiting its server copy is kept in place", () => {
  const pending = message({
    id: "task:dashboard-message-new",
    submissionId: "new",
    timestamp: "2026-07-28T22:00:02.000Z",
  });
  const window = [
    message({ id: "event:session:9", sender: "reviewer", kind: "assistant", timestamp: "2026-07-28T22:00:00.000Z" }),
  ];

  const result = reconcileOptimisticMessages(window, [pending]);

  assert.deepEqual(result.messages, [...window, pending]);
  assert.deepEqual(result.unresolved, [pending]);
});

test("a failed message is kept even once the window moves past it", () => {
  const failed = message({
    id: "task:dashboard-message-bad",
    submissionId: "bad",
    timestamp: "2026-07-28T21:00:00.000Z",
    uiStatus: "failed",
    deliveryState: "failed",
  });
  const window = [
    message({ id: "event:session:9", sender: "reviewer", kind: "assistant", timestamp: "2026-07-28T22:00:00.000Z" }),
  ];

  const result = reconcileOptimisticMessages(window, [failed]);

  assert.deepEqual(result.unresolved, [failed]);
  assert.equal(result.messages[0], failed);
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
