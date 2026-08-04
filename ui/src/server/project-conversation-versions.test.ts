import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { Project } from "@/lib/types";
import { createConversationVersionReader } from "./project-conversation-versions.ts";

test("task claim and completion changes advance conversation versions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-conversation-version-"));
  const state = path.join(root, ".cairn-harness");
  mkdirSync(state);
  const file = path.join(state, "harness.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE tasks (
    id TEXT PRIMARY KEY, creator TEXT NOT NULL, assignee TEXT NOT NULL,
    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, claimed_at TEXT, completed_at TEXT
  );
  CREATE TABLE turns (
    sequence INTEGER PRIMARY KEY, agent_id TEXT NOT NULL, completed_at TEXT NOT NULL
  )`);
  db.prepare(`INSERT INTO tasks
    (id,creator,assignee,status,attempts,created_at)
    VALUES (?,?,?,?,?,?)`).run("message-1", "dashboard", "reviewer", "pending", 0, "2026-07-28T21:59:16Z");
  db.close();
  const read = createConversationVersionReader((database) => new DatabaseSync(database, { readOnly: true }));
  const project = fixtureProject(root);

  const pending = read(project).get("reviewer");
  update(file, "UPDATE tasks SET status='claimed',attempts=1,claimed_at=? WHERE id='message-1'", "2026-07-28T21:59:17Z");
  const claimed = read(project).get("reviewer");
  update(file, "UPDATE tasks SET status='completed',claimed_at=NULL,completed_at=? WHERE id='message-1'", "2026-07-28T22:07:01Z");
  const completed = read(project).get("reviewer");

  assert.notEqual(claimed, pending);
  assert.notEqual(completed, claimed);
  rmSync(root, { recursive: true, force: true });
});

function update(file: string, sql: string, timestamp: string) {
  const db = new DatabaseSync(file);
  db.prepare(sql).run(timestamp);
  db.close();
}

function fixtureProject(root: string): Project {
  return {
    id: "project",
    name: "Project",
    root,
    agents: [{
      id: "reviewer",
      role: "Reviewer",
      status: "idle",
      updatedAt: "2026-07-28T21:59:16Z",
    }],
    workItems: [],
    delegatedActions: [],
    activity: [],
    releases: 0,
  };
}
