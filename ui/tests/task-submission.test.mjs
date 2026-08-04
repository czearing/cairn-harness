import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { persistTaskSubmission, submissionSuccess } from "../src/server/task-submission.ts";
import { promoteManualRootBacklog } from "../src/server/root-task-admission.ts";

test("worker startup failures return persisted success without duplicating submissions", (context) => {
  const fixture = createFixture(context);
  const cases = [
    {
      id: "message-id",
      submission: {
        projectId: "project",
        root: fixture.workspace,
        paused: false,
        kind: "message",
        source: "message",
        assignee: "writer",
        topic: "dashboard-message",
        body: "Review the release.",
      },
      startWorker: () => {
        throw new Error("Worker executable missing");
      },
      expected: { ok: true, workerStarted: false, workerError: "Worker executable missing" },
    },
    {
      id: "work-item-id",
      submission: {
        projectId: "project",
        root: fixture.workspace,
        paused: false,
        kind: "root",
        source: "manual",
        assignee: "lead",
        topic: "work-item",
        body: "Ship the release.",
      },
      startWorker: () => false,
      expected: { ok: true, workerStarted: false, workerError: "Project worker did not start" },
    },
  ];

  for (const entry of cases) {
    const result = persistTaskSubmission(entry.submission, entry.startWorker, dependencies(entry.id));
    assert.deepEqual(submissionSuccess(result), entry.expected);
  }

  const rows = readTasks(fixture.database);
  assert.deepEqual(rows, [
    { id: "dashboard-message-project:message-id", kind: "message", body: "Review the release." },
    { id: "work-item-id", kind: "root", body: "Ship the release." },
  ]);
});

test("paused submissions remain persisted success without a worker warning", (context) => {
  const fixture = createFixture(context);
  let startupCalls = 0;
  const result = persistTaskSubmission({
    projectId: "project",
    root: fixture.workspace,
    paused: true,
    kind: "root",
    source: "manual",
    assignee: "lead",
    topic: "work-item",
    body: "Resume later.",
  }, () => {
    startupCalls += 1;
    return false;
  }, dependencies("paused-id"));

  assert.deepEqual(submissionSuccess(result), { ok: true, workerStarted: false });
  assert.equal(startupCalls, 0);
  assert.deepEqual(readTasks(fixture.database), [
    { id: "paused-id", kind: "root", body: "Resume later." },
  ]);
});

test("legacy dashboard message callers without submission IDs retain unique submissions", (context) => {
  const fixture = createFixture(context);
  let nextId = 0;
  let startupCalls = 0;
  const submission = {
    projectId: "project",
    root: fixture.workspace,
    paused: false,
    kind: "message",
    source: "message",
    assignee: "writer",
    topic: "dashboard-message",
    body: "Repeatable content.",
  };
  const dependencies = {
    createId: () => `legacy-${++nextId}`,
    now: () => "2026-07-15T16:00:00.000Z",
  };

  persistTaskSubmission(submission, () => { startupCalls += 1; return true; }, dependencies);
  persistTaskSubmission(submission, () => { startupCalls += 1; return true; }, dependencies);

  assert.equal(startupCalls, 2);
  assert.deepEqual(readTasks(fixture.database), [
    { id: "dashboard-message-project:legacy-1", kind: "message", body: "Repeatable content." },
    { id: "dashboard-message-project:legacy-2", kind: "message", body: "Repeatable content." },
  ]);
});

test("dashboard messages are idempotent across a lost response and reject conflicting reuse", (context) => {
  const fixture = createFixture(context);
  let startupCalls = 0;
  const submission = {
    projectId: "project",
    root: fixture.workspace,
    paused: false,
    kind: "message",
    source: "message",
    assignee: "writer",
    topic: "dashboard-message",
    body: "Only once.",
    submissionId: "project:retry-id",
  };
  const startWorker = () => {
    startupCalls += 1;
    return true;
  };
  const deps = dependencies("unused-id");

  // The first response is lost after persistence and worker startup.
  persistTaskSubmission(submission, startWorker, deps);
  assert.deepEqual(persistTaskSubmission(submission, startWorker, deps), {
    id: "dashboard-message-project:retry-id",
    status: "pending",
    workerStarted: false,
  });

  test("failed dashboard messages retry in place and retain durable order", (context) => {
    const fixture = createFixture(context);
    let startupCalls = 0;
    const first = {
      projectId: "project",
      root: fixture.workspace,
      paused: false,
      kind: "message",
      source: "message",
      assignee: "writer",
      topic: "dashboard-message",
      body: "First follow-up.",
      submissionId: "project:first",
    };
    const second = { ...first, body: "Second follow-up.", submissionId: "project:second" };
    const startWorker = () => { startupCalls += 1; return true; };

    persistTaskSubmission(first, startWorker, dependencies("unused"));
    persistTaskSubmission(second, startWorker, dependencies("unused"));
    const failed = new DatabaseSync(fixture.database);
    failed.prepare("UPDATE tasks SET status='failed',error='Session closed',completed_at=? WHERE id=?")
      .run("2026-07-15T16:01:00.000Z", "dashboard-message-project:first");
    failed.close();

    const retry = persistTaskSubmission(first, startWorker, dependencies("unused"));
    assert.equal(retry.status, "pending");
    assert.equal(retry.workerStarted, true);
    assert.equal(startupCalls, 3);

    const reopened = new DatabaseSync(fixture.database, { readOnly: true });
    assert.deepEqual(
      reopened.prepare("SELECT id,status,error,completed_at FROM tasks ORDER BY created_at,id").all()
        .map((row) => ({ ...row })),
      [
        { id: "dashboard-message-project:first", status: "pending", error: null, completed_at: null },
        { id: "dashboard-message-project:second", status: "pending", error: null, completed_at: null },
      ],
    );
    reopened.close();
  });
  assert.equal(startupCalls, 1);
  assert.deepEqual(readTasks(fixture.database), [
    { id: "dashboard-message-project:retry-id", kind: "message", body: "Only once." },
  ]);
  assert.throws(() => persistTaskSubmission({ ...submission, assignee: "reviewer" }, startWorker, deps), /conflicts with an existing task/);
  assert.throws(() => persistTaskSubmission({ ...submission, body: "Changed." }, startWorker, deps), /conflicts with an existing task/);
  assert.throws(() => persistTaskSubmission({ ...submission, projectId: "other" }, startWorker, deps), /does not belong to this project/);
  assert.equal(startupCalls, 1);
  assert.equal(readTasks(fixture.database).length, 1);
});

test("manual leader work items alone consume capacity and promote backlog oldest first", (context) => {
  const fixture = createFixture(context);
  const db = new DatabaseSync(fixture.database);
  db.prepare("UPDATE root_task_policy SET max_active_tasks=1,leader='principal' WHERE singleton=1").run();
  const insert = db.prepare(`INSERT INTO tasks(
    id,parent_id,kind,source,creator,assignee,topic,body,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  insert.run("chat-root", null, "root", "message", "dashboard", "principal", "dashboard-message", "Chat", "pending", "2024-01-01T00:00:00Z");
  insert.run("automatic-root", null, "root", "automatic", "generator", "principal", "work-item", "Automatic", "pending", "2024-01-02T00:00:00Z");
  insert.run("idea-root", null, "root", "automatic", "idea-agent", "principal", "idea", "Idea", "pending", "2024-01-03T00:00:00Z");
  insert.run("delegated-child", "chat-root", "delegation", "manual", "principal", "worker", "work-item", "Child", "pending", "2024-01-04T00:00:00Z");
  insert.run("other-leader-root", null, "root", "manual", "dashboard", "former-principal", "work-item", "Other leader", "pending", "2024-01-05T00:00:00Z");
  db.close();

  const submission = {
    projectId: "project",
    root: fixture.workspace,
    paused: true,
    kind: "root",
    source: "manual",
    assignee: "principal",
    topic: "work-item",
  };
  persistTaskSubmission(
    { ...submission, body: "Active manual root." },
    () => false,
    dependencies("active-manual"),
  );
  const seeded = new DatabaseSync(fixture.database);
  assert.equal(taskStatus(seeded, "active-manual"), "pending");
  seeded.prepare(`INSERT INTO tasks(
    id,parent_id,kind,source,creator,assignee,topic,body,status,created_at)
    VALUES(?,NULL,'root','manual','dashboard','principal','work-item',?,'backlog',?)`)
    .run("oldest-backlog", "Oldest backlog.", "2026-07-15T15:59:59.000Z");
  seeded.close();

  persistTaskSubmission(
    { ...submission, body: "Newest manual root." },
    () => false,
    dependencies("newest-backlog"),
  );

  const check = new DatabaseSync(fixture.database);
  assert.equal(taskStatus(check, "newest-backlog"), "backlog");
  const claim = check.prepare(
    "UPDATE tasks SET status='claimed' WHERE id=? AND assignee=? AND status='pending'",
  ).run("newest-backlog", "principal");
  assert.equal(claim.changes, 0);

  check.prepare("UPDATE tasks SET status='completed',completed_at=? WHERE id=?")
    .run("2026-07-15T16:00:01.000Z", "active-manual");
  assert.equal(promoteManualRootBacklog(check), 1);
  assert.equal(taskStatus(check, "oldest-backlog"), "pending");
  assert.equal(taskStatus(check, "newest-backlog"), "backlog");
  check.close();
});

function dependencies(id) {
  return {
    createId: () => id,
    now: () => "2026-07-15T16:00:00.000Z",
  };
}

function createFixture(context) {
  const root = mkdtempSync(path.join(tmpdir(), "harness-task-submission-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const database = path.join(workspace, ".cairn-harness", "harness.db");
  mkdirSync(path.dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY,parent_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,
    body TEXT,status TEXT,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT
  );
  CREATE TABLE root_task_policy(singleton INTEGER PRIMARY KEY,max_active_tasks INTEGER NOT NULL,leader TEXT NOT NULL);
  INSERT INTO root_task_policy VALUES(1,0,'lead')`);
  db.close();
  return { workspace, database };
}

function readTasks(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  const rows = db.prepare("SELECT id,kind,body FROM tasks ORDER BY id").all();
  db.close();
  return rows.map((row) => ({ ...row }));
}

function taskStatus(db, id) {
  return db.prepare("SELECT status FROM tasks WHERE id=?").get(id).status;
}
