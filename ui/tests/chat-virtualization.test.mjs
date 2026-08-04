import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_DEFAULT_ITEM_HEIGHT,
  CHAT_FOLLOW_THRESHOLD,
  chatFirstItemIndex,
  estimateChatDefaultHeight,
  estimateChatMessageHeight,
} from "../src/components/ChatPanel/chat-virtualization.ts";

const message = (body, kind = "assistant") => ({
  id: "message",
  sender: "lead",
  recipient: "dashboard",
  body,
  status: "completed",
  timestamp: "2026-07-15T12:00:00Z",
  direction: "incoming",
  kind,
});

test("chat indexes remain stable when older pages are prepended", () => {
  const initialFirst = chatFirstItemIndex(0);
  const prependedFirst = chatFirstItemIndex(30);
  assert.equal(initialFirst - prependedFirst, 30);
});

test("chat height estimates account for variable message content", () => {
  const short = estimateChatMessageHeight(message("Short."));
  const multiline = estimateChatMessageHeight(message("One\n\n" + "Long content ".repeat(60)));
  assert.equal(CHAT_FOLLOW_THRESHOLD, 48);
  assert.ok(short >= CHAT_DEFAULT_ITEM_HEIGHT - 20);
  assert.ok(multiline > short * 3);
  assert.equal(estimateChatMessageHeight(message("tool output", "tool")), 52);
  assert.equal(estimateChatDefaultHeight([
    message("Short."),
    message("Medium ".repeat(30)),
    message("Long ".repeat(300)),
  ]), estimateChatMessageHeight(message("Medium ".repeat(30))));
});
