import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { formatTime } from "../src/components/ChatPanel/chat-utils.ts";
import {
  normalizeSessionEventTimestamp,
  readRecentSessionEvents,
  readSessionEventWindow,
} from "../src/server/session-events.ts";

test("session event timestamps normalize without throwing", () => {
  assert.equal(normalizeSessionEventTimestamp("2026-07-15T12:34:56-04:00"), "2026-07-15T16:34:56.000Z");
  assert.equal(normalizeSessionEventTimestamp(0), "1970-01-01T00:00:00.000Z");
  assert.equal(normalizeSessionEventTimestamp("not-a-date"), "");
  assert.equal(normalizeSessionEventTimestamp(""), "");
  assert.equal(normalizeSessionEventTimestamp(Number.NaN), "");
  assert.equal(normalizeSessionEventTimestamp(Number.POSITIVE_INFINITY), "");
  assert.equal(normalizeSessionEventTimestamp(8.64e15 + 1), "");
  assert.equal(normalizeSessionEventTimestamp(undefined), "");
  assert.equal(normalizeSessionEventTimestamp(null), "");
});

test("chat timestamp formatting is defensive", () => {
  const timestamp = "2026-07-15T16:34:56.000Z";
  const expected = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
  assert.equal(formatTime(timestamp), expected);
  assert.equal(formatTime(""), "");
  assert.equal(formatTime("not-a-date"), "");
});

test("malformed session timestamps remain visible without affecting valid cursor order", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-session-timestamps-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const agent = "lead";
  const sessionId = "timestamp-session";
  const sessionDirectory = path.join(root, ".cairn-harness", "copilot-home", agent, "session-state", sessionId);
  const events = [
    { type: "assistant.message", timestamp: "2026-07-15T12:03:00Z", data: { content: "Late message" } },
    { type: "assistant.message", timestamp: "malformed", data: { content: "Malformed timestamp message" } },
    { type: "assistant.message", timestamp: "2026-07-15T12:01:00Z", data: { content: "Early message" } },
    { type: "assistant.message", timestamp: "2026-07-15T12:02:00Z", data: { content: "Middle message" } },
  ];
  mkdirSync(sessionDirectory, { recursive: true });
  writeFileSync(path.join(sessionDirectory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

  const conversation = readRecentSessionEvents(root, agent, undefined, 10);
  assert.equal(conversation.items.length, 4);
  assert.equal(conversation.hasMore, false);
  assert.deepEqual(
    conversation.items.map(({ body, timestamp }) => [body, timestamp]),
    [
      ["Malformed timestamp message", ""],
      ["Early message", "2026-07-15T12:01:00.000Z"],
      ["Middle message", "2026-07-15T12:02:00.000Z"],
      ["Late message", "2026-07-15T12:03:00.000Z"],
    ],
  );

  const validAgent = "valid-agent";
  const validSessionId = "valid-timestamp-session";
  const validSessionDirectory = path.join(root, ".cairn-harness", "copilot-home", validAgent, "session-state", validSessionId);
  mkdirSync(validSessionDirectory, { recursive: true });
  writeFileSync(
    path.join(validSessionDirectory, "events.jsonl"),
    `${[events[0], events[2], events[3]].map((event) => JSON.stringify(event)).join("\n")}\n`,
  );

  const anchor = "2026-07-15T12:02:00.000Z\u0000event:valid-timestamp-session:2";
  assert.deepEqual(
    readSessionEventWindow(root, validAgent, anchor, 1, 1).map((message) => message.body),
    ["Early message", "Middle message", "Late message"],
  );
});

test("terminal task completion tool activity is not projected beside the final response", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-session-completion-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const agent = "developer";
  const sessionId = "completion-session";
  const sessionDirectory = path.join(root, ".cairn-harness", "copilot-home", agent, "session-state", sessionId);
  mkdirSync(sessionDirectory, { recursive: true });
  const events = [
    { type: "tool.execution_start", timestamp: "2026-07-15T12:00:00Z", data: {
      toolCallId: "complete-1",
      toolName: "cairn-harness/task_complete",
      arguments: { result: "Implemented the fix." },
    } },
    { type: "tool.execution_complete", timestamp: "2026-07-15T12:00:01Z", data: {
      toolCallId: "complete-1",
      success: true,
    } },
    { type: "assistant.message", timestamp: "2026-07-15T12:00:02Z", data: {
      content: "Implemented the fix.",
    } },
  ];
  writeFileSync(path.join(sessionDirectory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

  const conversation = readRecentSessionEvents(root, agent, undefined, 10);
  assert.equal(conversation.items.length, 1);
  assert.equal(conversation.items[0].kind, "assistant");
  assert.equal(conversation.items[0].body, "Implemented the fix.");
});
