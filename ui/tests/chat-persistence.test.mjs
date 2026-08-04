import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { readConversationPage } = await import("../src/server/chat.ts");

test("durable messages project queued, working, replied, and retry identity after reopen", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-chat-persistence-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".cairn-harness"), { recursive: true });
  const database = path.join(root, ".cairn-harness", "harness.db");
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE tasks(
      id TEXT PRIMARY KEY,creator TEXT,assignee TEXT,body TEXT,status TEXT,error TEXT,
      created_at TEXT,completed_at TEXT
    );
    CREATE TABLE turns(
      sequence INTEGER PRIMARY KEY,message_id TEXT,agent_id TEXT,output_json TEXT,status TEXT,
      started_at TEXT,completed_at TEXT
    );
    CREATE TABLE context_resets(agent_id TEXT PRIMARY KEY,cleared_at TEXT);
    INSERT INTO tasks VALUES(
      'dashboard-message-project:one','dashboard','lead','Follow up','pending',NULL,
      '2026-07-15T16:00:00Z',NULL
    );
  `);
  const agent = {
    id: "lead",
    role: "Lead",
    status: "idle",
    updatedAt: "2026-07-15T16:00:00Z",
  };
  assert.equal(readConversationPage(db, root, agent).items[0].deliveryState, "queued");
  db.prepare("UPDATE tasks SET status='claimed' WHERE id=?").run("dashboard-message-project:one");
  const workingAgent = { ...agent, status: "working", topic: "dashboard-message" };
  assert.equal(readConversationPage(db, root, workingAgent).items[0].deliveryState, "working");
  const sessionDirectory = path.join(root, ".cairn-harness", "copilot-home", "lead", "session-state", "session-one");
  mkdirSync(sessionDirectory, { recursive: true });
  const eventsFile = path.join(sessionDirectory, "events.jsonl");
  writeFileSync(eventsFile, `${JSON.stringify({
    type: "assistant.message",
    timestamp: "2026-07-15T16:00:20Z",
    data: { content: "I am checking the current behavior." },
  })}\n`);
  const liveDirectory = path.join(root, ".cairn-harness", "live-responses");
  mkdirSync(liveDirectory);
  const liveFile = path.join(liveDirectory, "lead.json");
  writeFileSync(liveFile, JSON.stringify({
    sessionId: "session-one",
    body: "I am checking the current behavior. Still working.",
    updatedAt: "2026-07-15T16:00:30Z",
  }));
  const workingItems = readConversationPage(db, root, workingAgent).items;
  assert.equal(workingItems.filter((item) => item.sender === "lead" && item.kind === "assistant").length, 1);
  assert.equal(workingItems.at(-1).body, "I am checking the current behavior. Still working.");
  assert.equal(workingItems.at(-1).live, true);
  unlinkSync(liveFile);
  assert.equal(readConversationPage(db, root, workingAgent).items.at(-1).body, "I am checking the current behavior.");
  db.prepare("UPDATE tasks SET status='completed',completed_at=? WHERE id=?")
    .run("2026-07-15T16:01:00Z", "dashboard-message-project:one");
  db.prepare("INSERT INTO turns VALUES(1,?,?,?,?,?,?)").run(
    "dashboard-message-project:one",
    "lead",
    '{"summary":"Answered follow-up","deliverable":null}',
    "completed",
    "2026-07-15T16:00:10Z",
    "2026-07-15T16:01:00Z",
  );
  db.close();
  writeFileSync(eventsFile, `${JSON.stringify({
    type: "assistant.message",
    timestamp: "2026-07-15T16:00:59Z",
    data: { content: "Answered follow-up" },
  })}\n`, { flag: "a" });

  const reopened = new DatabaseSync(database, { readOnly: true });
  const items = readConversationPage(reopened, root, agent).items;
  reopened.close();
  assert.equal(items[0].deliveryState, "replied");
  assert.equal(items[0].submissionId, "project:one");
  assert.equal(items.at(-1).kind, "assistant");
  assert.equal(items.at(-1).body, "Answered follow-up");
});
