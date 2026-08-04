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
  performProjectPause,
  performProjectRestart,
  setProjectStateInDatabase,
} = await import("../src/server/supervisor.ts");
const { pauseAgentInDatabase } = await import("../src/server/mutations.ts");
const { withSqliteRetry } = await import("../src/server/sqlite-retry.ts");

test("project state retries transient SQLite shutdown races", () => {
  let attempts = 0;
  const result = withSqliteRetry(() => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("disk I/O error");
      error.errcode = 10;
      throw error;
    }
    return "ready";
  }, 5, 0);

  assert.equal(result, "ready");
  assert.equal(attempts, 3);
  assert.throws(
    () => withSqliteRetry(() => {
      const error = new Error("schema mismatch");
      error.errcode = 1;
      throw error;
    }, 5, 0),
    /schema mismatch/,
  );
});

test("project pause rolls back only its new marker when stopping fails", () => {
  const stopError = new Error("Could not stop project worker");
  const workerRecord = { pid: 42, process: { start: "owned", command: "worker" } };
  let marker = false;
  let databaseTransitions = 0;
  const calls = [];

  assert.throws(() => performProjectPause({
    markerExists: () => marker,
    writeMarker: () => { calls.push("marker"); marker = true; },
    stop: () => { calls.push("stop"); throw stopError; },
    setPaused: () => { databaseTransitions += 1; },
    removeMarker: () => { calls.push("cleanup"); marker = false; },
  }), (error) => error === stopError);
  assert.deepEqual(calls, ["marker", "stop", "cleanup"]);
  assert.equal(marker, false);
  assert.equal(databaseTransitions, 0);
  assert.deepEqual(workerRecord, { pid: 42, process: { start: "owned", command: "worker" } });

  calls.length = 0;
  performProjectPause({
    markerExists: () => marker,
    writeMarker: () => { calls.push("marker"); marker = true; },
    stop: () => { calls.push("stop"); },
    setPaused: () => {
      calls.push("database:requeue");
      calls.push("database:pause-agents");
      databaseTransitions += 1;
    },
    removeMarker: () => { calls.push("cleanup"); marker = false; },
  });
  assert.deepEqual(calls, ["marker", "stop", "database:requeue", "database:pause-agents"]);
  assert.equal(marker, true);
  assert.equal(databaseTransitions, 1);

  calls.length = 0;
  assert.throws(() => performProjectPause({
    markerExists: () => true,
    writeMarker: () => { calls.push("marker"); },
    stop: () => { calls.push("stop"); throw stopError; },
    setPaused: () => { databaseTransitions += 1; },
    removeMarker: () => { calls.push("cleanup"); marker = false; },
  }), (error) => error === stopError);
  assert.deepEqual(calls, ["marker", "stop"]);
  assert.equal(marker, true);
  assert.equal(databaseTransitions, 1);

  assert.throws(() => performProjectPause({
    markerExists: () => false,
    writeMarker: () => {},
    stop: () => { throw stopError; },
    setPaused: () => { databaseTransitions += 1; },
    removeMarker: () => { throw new Error("Marker cleanup failed"); },
  }), (error) => error === stopError);
  assert.equal(databaseTransitions, 1);
});

test("project restart reconciles fresh claims only after a successful stop", () => {
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
      attempts INTEGER NOT NULL,
      claimed_at TEXT,
      error TEXT
    );
    CREATE TABLE operator_pauses(agent_id TEXT PRIMARY KEY);
    INSERT INTO agents VALUES
      ('operator-paused','paused','operator work','operator-time'),
      ('worker','working','fresh claim','worker-time');
    INSERT INTO operator_pauses VALUES('operator-paused');
    INSERT INTO tasks VALUES
      ('fresh-claim','worker','claimed',3,'just-now',NULL),
      ('completed','worker','completed',1,NULL,NULL),
      ('cancelled','worker','cancelled',2,NULL,NULL),
      ('waiting','worker','waiting',1,NULL,NULL);
  `);
  const calls = [];
  performProjectRestart({
    stop: () => { calls.push("stop"); },
    paused: () => false,
    reconcile: (paused) => {
      assert.equal(paused, false);
      calls.push("reconcile");
      setProjectStateInDatabase(db, "idle", true);
    },
    start: () => {
      calls.push("start");
      assert.deepEqual(taskRestartState(db, "fresh-claim"), {
        status: "pending",
        attempts: 3,
        claimed_at: null,
      });
      assert.equal(agentStatus(db, "worker"), "idle");
      assert.equal(agentStatus(db, "operator-paused"), "paused");
      const claimed = db.prepare(`UPDATE tasks SET status='claimed',claimed_at='replacement-now'
        WHERE id=(SELECT id FROM tasks WHERE assignee='worker' AND status='pending' LIMIT 1)
        RETURNING id`).get();
      assert.deepEqual({ ...claimed }, { id: "fresh-claim" });
    },
  });

  assert.deepEqual(calls, ["stop", "reconcile", "start"]);
  assert.deepEqual(taskRestartState(db, "fresh-claim"), {
    status: "claimed",
    attempts: 3,
    claimed_at: "replacement-now",
  });
  assert.equal(taskRestartState(db, "completed").status, "completed");
  assert.equal(taskRestartState(db, "cancelled").status, "cancelled");
  assert.equal(taskRestartState(db, "waiting").status, "waiting");

  const stopError = new Error("stop failed");
  assert.throws(() => performProjectRestart({
    stop: () => { throw stopError; },
    paused: () => false,
    reconcile: () => { calls.push("unexpected-reconcile"); },
    start: () => { calls.push("unexpected-start"); },
  }), (error) => error === stopError);
  assert.deepEqual(calls, ["stop", "reconcile", "start"]);
  db.close();
});

test("project pause and resume preserve operator-paused agents and tasks", () => {
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
    INSERT INTO agents VALUES
      ('operator-paused','idle','operator work','before-pause'),
      ('worker','idle','active work','worker-time');
    INSERT INTO tasks VALUES
      ('operator-task','operator-paused','claimed','operator-claim',NULL),
      ('worker-task','worker','claimed','claim-time',NULL);
  `);

  pauseAgentInDatabase(db, "operator-paused", "operator-pause-time");
  setProjectStateInDatabase(db, "paused", true);
  assert.equal(agentStatus(db, "operator-paused"), "paused");
  assert.equal(agentStatus(db, "worker"), "paused");
  assert.deepEqual(taskState(db, "operator-task"), {
    status: "deferred",
    claimed_at: null,
    error: "Paused by operator",
  });
  assert.deepEqual(taskState(db, "worker-task"), {
    status: "pending",
    claimed_at: null,
    error: null,
  });

  setProjectStateInDatabase(db, "idle", false);
  assert.equal(agentStatus(db, "operator-paused"), "paused");
  assert.equal(agentStatus(db, "worker"), "idle");
  assert.deepEqual(taskState(db, "operator-task"), {
    status: "deferred",
    claimed_at: null,
    error: "Paused by operator",
  });
  db.close();
});

test("legacy operator-paused task markers backfill pause provenance", () => {
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
    INSERT INTO agents VALUES
      ('operator-paused','paused',NULL,'operator-pause-time'),
      ('worker','paused',NULL,'project-pause-time');
    INSERT INTO tasks VALUES
      ('operator-task','operator-paused','deferred',NULL,'Paused by operator'),
      ('worker-task','worker','pending',NULL,NULL);
  `);

  setProjectStateInDatabase(db, "idle", false);

  assert.equal(agentStatus(db, "operator-paused"), "paused");
  assert.equal(agentStatus(db, "worker"), "idle");
  assert.deepEqual(taskState(db, "operator-task"), {
    status: "deferred",
    claimed_at: null,
    error: "Paused by operator",
  });
  assert.deepEqual(
    [...db.prepare("SELECT agent_id FROM operator_pauses").all()].map((row) => ({ ...row })),
    [{ agent_id: "operator-paused" }],
  );
  db.close();
});

function agentStatus(db, agentId) {
  return db.prepare("SELECT status FROM agents WHERE agent_id=?").get(agentId).status;
}

function taskState(db, taskId) {
  return { ...db.prepare("SELECT status,claimed_at,error FROM tasks WHERE id=?").get(taskId) };
}

function taskRestartState(db, taskId) {
  return { ...db.prepare("SELECT status,attempts,claimed_at FROM tasks WHERE id=?").get(taskId) };
}
