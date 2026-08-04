import assert from "node:assert/strict";
import test from "node:test";
import {
  chatGroupPosition,
  chatMessageStatus,
  conversationUnitCount,
  hasTruthfulWorkingIndicator,
} from "../src/components/ChatPanel/chat-utils.ts";

const base = {
  recipient: "lead",
  body: "Message",
  status: "completed",
  direction: "incoming",
  kind: "message",
};

test("conversation grouping respects sender, day, time, and event boundaries", () => {
  const messages = [
    { ...base, id: "1", sender: "lead", timestamp: "2026-07-15T16:00:00.000Z" },
    { ...base, id: "2", sender: "lead", timestamp: "2026-07-15T16:04:00.000Z", kind: "assistant" },
    { ...base, id: "3", sender: "lead", timestamp: "2026-07-15T16:05:00.000Z", kind: "tool" },
    { ...base, id: "4", sender: "lead", timestamp: "2026-07-15T16:06:00.000Z" },
  ];
  assert.equal(chatGroupPosition(messages, 0), "start");
  assert.equal(chatGroupPosition(messages, 1), "end");
  assert.equal(chatGroupPosition(messages, 2), "single");
  assert.equal(chatGroupPosition(messages, 3), "single");
});

test("working activity requires fresh matching telemetry after an unresolved operator message", () => {
  const message = { ...base, id: "operator", sender: "dashboard", timestamp: "2026-07-15T16:00:00.000Z" };
  const agent = { id: "lead", role: "Lead", status: "working", topic: "dashboard-message", updatedAt: "2026-07-15T16:00:30.000Z" };
  assert.equal(hasTruthfulWorkingIndicator(agent, [message], Date.parse("2026-07-15T16:01:00.000Z")), true);
  assert.equal(hasTruthfulWorkingIndicator({ ...agent, status: "idle" }, [message], Date.parse("2026-07-15T16:01:00.000Z")), false);
  assert.equal(hasTruthfulWorkingIndicator({ ...agent, topic: "other" }, [message], Date.parse("2026-07-15T16:01:00.000Z")), false);
  assert.equal(hasTruthfulWorkingIndicator({ ...agent, updatedAt: "2026-07-15T15:59:59.000Z" }, [message], Date.parse("2026-07-15T16:01:00.000Z")), false);
  assert.equal(hasTruthfulWorkingIndicator(agent, [message], Date.parse("2026-07-15T16:02:01.000Z")), false);
  assert.equal(hasTruthfulWorkingIndicator(agent, [
    message,
    { ...base, id: "reply", sender: "lead", timestamp: "2026-07-15T16:00:40.000Z", kind: "assistant" },
  ], Date.parse("2026-07-15T16:01:00.000Z")), false);
  assert.equal(hasTruthfulWorkingIndicator(
    { ...agent, status: "idle" },
    [{ ...message, deliveryState: "working" }],
    Date.parse("2026-07-15T16:01:00.000Z"),
  ), true);
});

test("conversation units and optimistic status remain truthful", () => {
  const tools = [
    { ...base, id: "tool-1", sender: "lead", timestamp: "2026-07-15T16:00:00.000Z", kind: "tool" },
    { ...base, id: "tool-2", sender: "lead", timestamp: "2026-07-15T16:00:01.000Z", kind: "tool" },
    { ...base, id: "reply", sender: "lead", timestamp: "2026-07-15T16:01:00.000Z", kind: "assistant" },
  ];
  assert.equal(conversationUnitCount(tools), 2);
  assert.equal(chatMessageStatus({ ...base, id: "sending", sender: "dashboard", timestamp: "", uiStatus: "sending" }), "Sending");
  assert.equal(chatMessageStatus({ ...base, id: "failed", sender: "dashboard", timestamp: "", uiStatus: "failed" }), "Failed");
  assert.equal(chatMessageStatus({ ...base, id: "queued", sender: "dashboard", timestamp: "", status: "pending", workerStarted: false, workerError: "missing" }), "Queued, agents not running");
  assert.equal(chatMessageStatus({ ...base, id: "delivered", sender: "dashboard", timestamp: "", deliveryState: "delivered" }), "Delivered to agent session");
  assert.equal(chatMessageStatus({ ...base, id: "working", sender: "dashboard", timestamp: "", deliveryState: "working" }), "Working");
  assert.equal(chatMessageStatus({ ...base, id: "replied", sender: "dashboard", timestamp: "", deliveryState: "replied" }), "Replied");
});
