import assert from "node:assert/strict";
import { appendFileSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSessionEventReader } from "../src/server/session-events.ts";

test("session cache failures do not hide readable source events", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-session-cache-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [
    event("First response", "2026-07-15T12:00:00Z"),
    event("Second response", "2026-07-15T12:01:00Z"),
  ];

  const mkdirAgent = "mkdir-agent";
  seedSession(root, mkdirAgent, "mkdir-failure", events);
  const mkdirFailure = createSessionEventReader({
    mkdirSync: () => { throw new Error("Cache directory denied"); },
  });
  assert.deepEqual(readBodies(mkdirFailure, root, mkdirAgent), {
    items: ["First response", "Second response"],
    hasMore: false,
  });

  const writeAgent = "write-agent";
  seedSession(root, writeAgent, "write-failure", events);
  let sourceOpens = 0;
  const writeFailure = createSessionEventReader({
    openSync: (...arguments_) => {
      sourceOpens += 1;
      return openSync(...arguments_);
    },
    writeFileSync: () => { throw new Error("Cache disk full"); },
  });
  assert.deepEqual(readBodies(writeFailure, root, writeAgent), {
    items: ["First response", "Second response"],
    hasMore: false,
  });
  assert.equal(sourceOpens, 1);
  assert.deepEqual(readBodies(writeFailure, root, writeAgent), {
    items: ["First response", "Second response"],
    hasMore: false,
  });
  assert.equal(sourceOpens, 1);

  const incrementalAgent = "incremental-agent";
  const incrementalFile = seedSession(root, incrementalAgent, "incremental", [events[0]]);
  const writable = createSessionEventReader({});
  assert.deepEqual(readBodies(writable, root, incrementalAgent).items, ["First response"]);
  appendFileSync(incrementalFile, `${JSON.stringify(events[1])}\n`);
  assert.deepEqual(readBodies(writable, root, incrementalAgent).items, ["First response", "Second response"]);
  const cache = JSON.parse(readFileSync(
    path.join(root, ".cairn-harness", "ui-session-cache", incrementalAgent, "incremental.json"),
    "utf8",
  ));
  assert.equal(cache.offset, statSync(incrementalFile).size);

  const sourceFailureFile = seedSession(root, "source-agent", "source-failure", events);
  const sourceFailure = createSessionEventReader({
    openSync: (file, ...arguments_) => {
      if (file === sourceFailureFile) throw new Error("Source read denied");
      return openSync(file, ...arguments_);
    },
  });
  assert.throws(
    () => sourceFailure.readRecentSessionEvents(root, "source-agent", undefined, 10),
    /Source read denied/,
  );
});

test("structurally invalid session caches rebuild while valid caches avoid source reads", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-session-cache-shape-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [event("Source response", "2026-07-15T12:00:00Z")];
  const invalidCaches = [
    { offset: 0, messages: [], tools: [], pending: [] },
    { offset: "0", nextIndex: 0, messages: [], tools: [], pending: [] },
    { offset: 0, nextIndex: 0, messages: [{ body: "missing message fields" }], tools: [], pending: [] },
    { offset: 0, nextIndex: 0, messages: [], tools: [["tool-only"]], pending: [["call", 42]] },
  ];

  for (const [index, invalid] of invalidCaches.entries()) {
    const agent = `invalid-agent-${index}`;
    const sessionId = `invalid-session-${index}`;
    seedSession(root, agent, sessionId, events);
    const cacheFile = seedCache(root, agent, sessionId, invalid);

    assert.deepEqual(readBodies(createSessionEventReader({}), root, agent), {
      items: ["Source response"],
      hasMore: false,
    });
    const rebuilt = JSON.parse(readFileSync(cacheFile, "utf8"));
    assert.equal(typeof rebuilt.offset, "number");
    assert.equal(typeof rebuilt.nextIndex, "number");
    assert.equal(rebuilt.messages[0].body, "Source response");
    assert.deepEqual(rebuilt.tools, []);
    assert.deepEqual(rebuilt.pending, []);
  }

  const validAgent = "valid-cache-agent";
  const validSessionId = "valid-cache-session";
  const sourceFile = seedSession(root, validAgent, validSessionId, events);
  const size = statSync(sourceFile).size;
  seedCache(root, validAgent, validSessionId, {
    version: 2,
    offset: size,
    nextIndex: 1,
    messages: [{
      id: `event:${validSessionId}:0`,
      sender: validAgent,
      recipient: "team",
      body: "Cached response",
      status: "recorded",
      timestamp: "2026-07-15T12:00:00.000Z",
      direction: "outgoing",
      kind: "assistant",
      title: "Response",
    }],
    tools: [],
    pending: [],
  });
  const validReader = createSessionEventReader({
    openSync: () => { throw new Error("Source should not reopen"); },
  });
  assert.deepEqual(readBodies(validReader, root, validAgent), {
    items: ["Cached response"],
    hasMore: false,
  });
});

test("session catch-up reads bounded chunks and retains an unterminated record", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-session-chunks-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const agent = "chunk-agent";
  const sessionId = "chunk-session";
  const lines = [
    event("First response", "2026-07-15T12:00:00Z"),
    {
      type: "tool.execution_start",
      timestamp: "2026-07-15T12:01:00Z",
      data: { toolCallId: "call-1", toolName: "cairn-harness-message_send", arguments: { body: "request" } },
    },
    ...Array.from({ length: 64 }, (_, index) => ({
      type: "user.message",
      timestamp: `2026-07-15T12:${String(index + 2).padStart(2, "0")}:00Z`,
      data: { content: "x".repeat(48 * 1024) },
    })),
    {
      type: "tool.execution_complete",
      timestamp: "2026-07-15T13:10:00Z",
      data: { toolCallId: "call-1", success: true, result: { content: "Tool result" } },
    },
    event(`Boundary response ${"y".repeat(80 * 1024)}`, "2026-07-15T13:11:00Z"),
  ];
  const final = event("Final pending response", "2026-07-15T13:12:00Z");
  const completeText = `${lines.map((value) => JSON.stringify(value)).join("\n")}\n`;
  const file = seedSessionText(root, agent, sessionId, `${completeText}${JSON.stringify(final)}`);
  const reads = [];
  let opens = 0;
  let closes = 0;
  const reader = createSessionEventReader({
    openSync: (...arguments_) => {
      opens += 1;
      return openSync(...arguments_);
    },
    readSync: (descriptor, buffer, offset, length, position) => {
      reads.push(length);
      return readSync(descriptor, buffer, offset, length, position);
    },
    closeSync: (descriptor) => {
      closes += 1;
      closeSync(descriptor);
    },
  });

  const first = reader.readRecentSessionEvents(root, agent, undefined, 20);
  assert.equal(opens, 1);
  assert.equal(closes, 1);
  assert.ok(reads.length > 40);
  assert.ok(reads.every((length) => length <= 64 * 1024));
  assert.deepEqual(first.items.map((message) => ({ id: message.id, kind: message.kind, body: message.body.slice(0, 24) })), [
    { id: `event:${sessionId}:0`, kind: "assistant", body: "First response" },
    { id: `event:${sessionId}:66`, kind: "tool", body: "Completed Message send" },
    { id: `event:${sessionId}:67`, kind: "assistant", body: "Boundary response yyyyyy" },
  ]);
  const cacheFile = path.join(root, ".cairn-harness", "ui-session-cache", agent, `${sessionId}.json`);
  const firstCache = JSON.parse(readFileSync(cacheFile, "utf8"));
  assert.equal(firstCache.offset, Buffer.byteLength(completeText));
  assert.equal(firstCache.nextIndex, 68);

  appendFileSync(file, "\n");
  const second = reader.readRecentSessionEvents(root, agent, undefined, 20);
  assert.equal(opens, 2);
  assert.equal(closes, 2);
  assert.deepEqual(second.items.map((message) => message.id), [
    `event:${sessionId}:0`,
    `event:${sessionId}:66`,
    `event:${sessionId}:67`,
    `event:${sessionId}:68`,
  ]);
  assert.equal(second.items.filter((message) => message.body === "Final pending response").length, 1);
  const secondCache = JSON.parse(readFileSync(cacheFile, "utf8"));
  assert.equal(secondCache.offset, statSync(file).size);
  assert.equal(secondCache.nextIndex, 69);

  const failureFile = seedSession(root, "read-failure-agent", "read-failure", [event("Unread", "2026-07-15T14:00:00Z")]);
  let failureCloses = 0;
  const failingReader = createSessionEventReader({
    openSync: (...arguments_) => openSync(...arguments_),
    readSync: () => { throw new Error("Injected source read failure"); },
    closeSync: (descriptor) => {
      failureCloses += 1;
      closeSync(descriptor);
    },
  });
  assert.throws(
    () => failingReader.readRecentSessionEvents(root, "read-failure-agent", undefined, 20),
    /Injected source read failure/,
  );
  assert.equal(failureCloses, 1);
  assert.ok(statSync(failureFile).size > 0);
});

test("session state cache evicts only the least-recently-used session", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-session-lru-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceOpens = new Map();
  const agents = ["agent-a", "agent-b", "agent-c", "agent-d"];
  const files = new Map(agents.map((agent, index) => [
    agent,
    seedSession(root, agent, `session-${index}`, [event(`Response ${agent}`, `2026-07-15T12:0${index}:00Z`)]),
  ]));
  const reader = createSessionEventReader({
    mkdirSync: () => { throw new Error("Disk cache unavailable"); },
    openSync: (file, ...arguments_) => {
      sourceOpens.set(file, (sourceOpens.get(file) || 0) + 1);
      return openSync(file, ...arguments_);
    },
  }, 3);

  const first = new Map();
  for (const agent of agents.slice(0, 3)) {
    first.set(agent, reader.readRecentSessionEvents(root, agent, undefined, 10));
  }
  assert.equal(reader.cacheSize, 3);
  assert.deepEqual(reader.readRecentSessionEvents(root, "agent-a", undefined, 10), first.get("agent-a"));
  assert.equal(sourceOpens.get(files.get("agent-a")), 1);

  first.set("agent-d", reader.readRecentSessionEvents(root, "agent-d", undefined, 10));
  assert.equal(reader.cacheSize, 3);
  assert.deepEqual([...sourceOpens.values()], [1, 1, 1, 1]);

  for (const agent of ["agent-a", "agent-c", "agent-d"]) {
    assert.deepEqual(reader.readRecentSessionEvents(root, agent, undefined, 10), first.get(agent));
    assert.equal(sourceOpens.get(files.get(agent)), 1);
  }

  const reopened = reader.readRecentSessionEvents(root, "agent-b", undefined, 10);
  assert.deepEqual(reopened, first.get("agent-b"));
  assert.equal(sourceOpens.get(files.get("agent-b")), 2);
  assert.equal(reader.cacheSize, 3);
  assert.deepEqual(reopened.items.map((message) => message.id), ["event:session-1:0"]);
});

test("recent session pages select globally newest messages despite file mtimes", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-session-global-page-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const agent = "pagination-agent";
  const touchedOlder = seedSession(root, agent, "session-a", [
    event("First", "2026-07-15T12:00:00Z"),
    event("Second", "2026-07-15T12:01:00Z"),
    event("Newest", "2026-07-15T12:04:00Z"),
  ]);
  const newer = seedSession(root, agent, "session-b", [
    event("Third", "2026-07-15T12:02:00Z"),
    event("Fourth", "2026-07-15T12:03:00Z"),
  ]);
  const now = new Date();
  utimesSync(newer, now, new Date(now.getTime() - 1_000));
  utimesSync(touchedOlder, now, now);

  const page = createSessionEventReader({}).readRecentSessionEvents(root, agent, undefined, 3);

  assert.deepEqual(page.items.map((message) => message.id), [
    "event:session-b:0",
    "event:session-b:1",
    "event:session-a:2",
  ]);
  assert.equal(page.hasMore, true);
});

function readBodies(reader, root, agent) {
  const result = reader.readRecentSessionEvents(root, agent, undefined, 10);
  return { items: result.items.map((message) => message.body), hasMore: result.hasMore };
}

function seedSession(root, agent, sessionId, events) {
  return seedSessionText(root, agent, sessionId, `${events.map((value) => JSON.stringify(value)).join("\n")}\n`);
}

function seedSessionText(root, agent, sessionId, content) {
  const directory = path.join(root, ".cairn-harness", "copilot-home", agent, "session-state", sessionId);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "events.jsonl");
  writeFileSync(file, content);
  return file;
}

function seedCache(root, agent, sessionId, value) {
  const directory = path.join(root, ".cairn-harness", "ui-session-cache", agent);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${sessionId}.json`);
  writeFileSync(file, JSON.stringify(value));
  return file;
}

function event(content, timestamp) {
  return { type: "assistant.message", timestamp, data: { content } };
}
