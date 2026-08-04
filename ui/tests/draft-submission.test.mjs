import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { persistDraftSubmission } from "../src/server/draft-submission.ts";
import { promoteManualRootBacklog } from "../src/server/root-task-admission.ts";

test("draft submission is durable and idempotent across a post-insert failure", (context) => {
  const fixture = createFixture(context);
  const firstDraft = seedDraft(fixture.workspace, "draft-one", "Ship the release.");
  let failedAfterInsert = false;

  assert.throws(() => persistDraftSubmission(fixture.workspace, "lead", "draft-one", "Ship the release.", {
    removeDraft: () => {
      failedAfterInsert = true;
      throw new Error("Response interrupted after persistence");
    },
  }), /Response interrupted after persistence/);
  assert.equal(failedAfterInsert, true);
  assert.equal(existsSync(firstDraft), true);

  persistDraftSubmission(fixture.workspace, "lead", "draft-one", "Ship the release.", {
    removeDraft: (file) => rmSync(file, { force: true }),
  });

  test("reused draft identities create a stable content-specific task", (context) => {
    const fixture = createFixture(context);
    seedDraft(fixture.workspace, "reused", "First task.");
    const first = persistDraftSubmission(fixture.workspace, "lead", "reused", "First task.");
    seedDraft(fixture.workspace, "reused", "Second task.");
    const second = persistDraftSubmission(fixture.workspace, "lead", "reused", "Second task.");
    seedDraft(fixture.workspace, "reused", "Second task.");
    const retry = persistDraftSubmission(fixture.workspace, "lead", "reused", "Second task.");

    assert.equal(first.taskId, "dashboard-draft-reused");
    assert.match(second.taskId, /^dashboard-draft-reused-[a-f0-9]{16}$/);
    assert.equal(retry.taskId, second.taskId);
    assert.equal(retry.created, false);
    const db = new DatabaseSync(fixture.database, { readOnly: true });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 2);
    db.close();
  });

  const secondDraft = seedDraft(fixture.workspace, "draft-two", "Prepare the announcement.");
  persistDraftSubmission(fixture.workspace, "lead", "draft-two", "Prepare the announcement.", {
    removeDraft: (file) => rmSync(file, { force: true }),
  });

  const db = new DatabaseSync(fixture.database, { readOnly: true });
  const rows = db.prepare(`SELECT id,body FROM tasks
    WHERE kind='root' AND body IN (?,?) ORDER BY body`)
    .all("Ship the release.", "Prepare the announcement.");
  db.close();

  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "dashboard-draft-draft-two", body: "Prepare the announcement." },
    { id: "dashboard-draft-draft-one", body: "Ship the release." },
  ]);
  assert.equal(existsSync(firstDraft), false);
  assert.equal(existsSync(secondDraft), false);
});

test("submitDraft backlogs at manual root capacity, blocks principal claim, and promotes the oldest eligible root", (context) => {
  const fixture = createFixture(context);
  const db = new DatabaseSync(fixture.database);
  db.prepare("UPDATE root_task_policy SET max_active_tasks=1,leader='principal' WHERE singleton=1").run();
  const insert = db.prepare(`INSERT INTO tasks(
    id,parent_id,kind,source,creator,assignee,topic,body,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  insert.run("active-manual", null, "root", "manual", "dashboard", "principal", "work-item", "Active", "pending", "2024-01-01T00:00:00Z");
  insert.run("oldest-backlog", null, "root", "manual", "dashboard", "principal", "work-item", "Oldest", "backlog", "2024-01-02T00:00:00Z");
  insert.run("automatic-root", null, "root", "automatic", "generator", "principal", "work-item", "Automatic", "pending", "2024-01-03T00:00:00Z");
  insert.run("idea-root", null, "root", "automatic", "idea-agent", "principal", "idea", "Idea", "pending", "2024-01-04T00:00:00Z");
  insert.run("delegated-child", "active-manual", "delegation", "manual", "principal", "worker", "delegate", "Child", "pending", "2024-01-05T00:00:00Z");
  db.close();

  seedDraft(fixture.workspace, "new-root", "Newest manual root.");
  persistDraftSubmission(fixture.workspace, "principal", "new-root", "Newest manual root.");

  const check = new DatabaseSync(fixture.database);
  assert.equal(taskStatus(check, "dashboard-draft-new-root"), "backlog");
  const claim = check.prepare(
    "UPDATE tasks SET status='claimed' WHERE id=? AND assignee=? AND status='pending'",
  ).run("dashboard-draft-new-root", "principal");
  assert.equal(claim.changes, 0);

  check.prepare("UPDATE tasks SET status='completed',completed_at=? WHERE id=?")
    .run("2024-01-06T00:00:00Z", "active-manual");
  assert.equal(promoteManualRootBacklog(check), 1);
  assert.equal(taskStatus(check, "oldest-backlog"), "pending");
  assert.equal(taskStatus(check, "dashboard-draft-new-root"), "backlog");
  check.close();
});

function createFixture(context) {
  const root = mkdtempSync(path.join(tmpdir(), "harness-draft-submission-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const database = path.join(workspace, ".cairn-harness", "harness.db");
  mkdirSync(path.dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,
    assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,
    created_at TEXT,claimed_at TEXT,completed_at TEXT
  );
  CREATE TABLE root_task_policy(singleton INTEGER PRIMARY KEY,max_active_tasks INTEGER NOT NULL,leader TEXT NOT NULL);
  INSERT INTO root_task_policy(singleton,max_active_tasks,leader) VALUES(1,0,'lead')`);
  db.close();
  return { workspace, database };
}

function taskStatus(db, id) {
  return db.prepare("SELECT status FROM tasks WHERE id=?").get(id).status;
}

function seedDraft(workspace, id, body) {
  const file = path.join(workspace, ".cairn-harness", "drafts", `${id}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${body}\n`);
  return file;
}
