import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
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

const {
  pauseAgentInDatabase,
  resumeAgentInDatabase,
} = await import("../src/server/mutations.ts");

test("operator resume requeues only operator-paused tasks and rolls back atomically", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agents(
      agent_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      current_topic TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks(
      id TEXT PRIMARY KEY,
      assignee TEXT NOT NULL,
      status TEXT NOT NULL,
      claimed_at TEXT,
      error TEXT
    );
  `);
  const insertAgent = db.prepare("INSERT INTO agents VALUES(?,?,?,?)");
  insertAgent.run("builder", "idle", "active work", "before-pause");
  insertAgent.run("other", "paused", null, "other-time");
  const insertTask = db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?)");
  insertTask.run("operator-paused", "builder", "claimed", "claim-time", null);
  insertTask.run("budget-deferred", "builder", "deferred", null, "Budget exhausted: 12345 tokens");
  insertTask.run("other-agent", "other", "deferred", null, "Paused by operator");

  pauseAgentInDatabase(db, "builder", "pause-time");
  assert.deepEqual(task(db, "operator-paused"), {
    id: "operator-paused",
    assignee: "builder",
    status: "deferred",
    claimed_at: null,
    error: "Paused by operator",
  });
  assert.deepEqual(agent(db, "builder"), {
    agent_id: "builder",
    status: "paused",
    current_topic: null,
    updated_at: "pause-time",
  });
  assert.deepEqual(pauseMarkers(db), ["builder", "other"]);

  db.exec(`
    CREATE TRIGGER fail_operator_resume
    BEFORE UPDATE OF status ON tasks
    WHEN OLD.id = 'operator-paused'
    BEGIN
      SELECT RAISE(ABORT, 'injected resume failure');
    END;
  `);
  assert.throws(
    () => resumeAgentInDatabase(db, "builder", "failed-resume-time"),
    /injected resume failure/,
  );
  assert.deepEqual(agent(db, "builder"), {
    agent_id: "builder",
    status: "paused",
    current_topic: null,
    updated_at: "pause-time",
  });
  assert.equal(task(db, "operator-paused").status, "deferred");
  assert.equal(task(db, "operator-paused").error, "Paused by operator");
  assert.deepEqual(pauseMarkers(db), ["builder", "other"]);

  db.exec("DROP TRIGGER fail_operator_resume");
  resumeAgentInDatabase(db, "builder", "resume-time");

  assert.deepEqual(agent(db, "builder"), {
    agent_id: "builder",
    status: "idle",
    current_topic: null,
    updated_at: "resume-time",
  });
  assert.deepEqual(task(db, "operator-paused"), {
    id: "operator-paused",
    assignee: "builder",
    status: "pending",
    claimed_at: null,
    error: null,
  });
  assert.deepEqual(task(db, "budget-deferred"), {
    id: "budget-deferred",
    assignee: "builder",
    status: "deferred",
    claimed_at: null,
    error: "Budget exhausted: 12345 tokens",
  });
  assert.deepEqual(task(db, "other-agent"), {
    id: "other-agent",
    assignee: "other",
    status: "deferred",
    claimed_at: null,
    error: "Paused by operator",
  });
  assert.deepEqual(pauseMarkers(db), ["other"]);
  db.close();
});

function agent(db, id) {
  return { ...db.prepare("SELECT * FROM agents WHERE agent_id=?").get(id) };
}

function task(db, id) {
  return { ...db.prepare("SELECT * FROM tasks WHERE id=?").get(id) };
}

function pauseMarkers(db) {
  return db.prepare("SELECT agent_id FROM operator_pauses ORDER BY agent_id").all()
    .map((row) => row.agent_id);
}
