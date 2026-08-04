import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const { readLiveResponse } = await import("../src/server/live-response.ts");

test("working agents expose current live response text", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-live-response-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, ".cairn-harness", "live-responses");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "writer.json"), JSON.stringify({
    sessionId: "session-one",
    body: "Drafting the response now.",
    updatedAt: "2026-07-20T21:00:02Z",
  }));
  const agent = {
    id: "writer",
    role: "Writer",
    status: "working",
    updatedAt: "2026-07-20T21:00:00Z",
  };

  const response = readLiveResponse(root, agent);

  assert.equal(response?.id, "live:writer:session-one");
  assert.equal(response?.body, "Drafting the response now.");
  assert.equal(response?.live, true);
  assert.equal(readLiveResponse(root, { ...agent, status: "idle" }), undefined);
});

test("invalid and stale live response files stay hidden", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-live-response-stale-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, ".cairn-harness", "live-responses");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "writer.json");
  const agent = {
    id: "writer",
    role: "Writer",
    status: "working",
    updatedAt: "2026-07-20T21:00:00Z",
  };
  writeFileSync(file, "{ invalid");
  assert.equal(readLiveResponse(root, agent), undefined);
  writeFileSync(file, JSON.stringify({
    sessionId: "old-session",
    body: "Old response",
    updatedAt: "2026-07-20T20:59:59Z",
  }));
  assert.equal(readLiveResponse(root, agent), undefined);
});
