import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { cancelTaskTree, deleteTerminalTaskTree } from "../src/server/task-tree.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT, source TEXT, assignee TEXT, topic TEXT, status TEXT,
    claimed_at TEXT, completed_at TEXT
  );
  CREATE TABLE root_task_policy(singleton INTEGER PRIMARY KEY,max_active_tasks INTEGER NOT NULL,leader TEXT NOT NULL);
  INSERT INTO root_task_policy VALUES(1,0,'lead')`);
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,NULL)").run("root", null, "root", "manual", "lead", "work-item", "claimed", "now");
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,NULL)").run("child", "root", "delegation", "agent", "worker", "delegate", "pending", null);
  return db;
}

test("paused projects can cancel and delete a task tree", () => {
  const db = fixture();
  assert.equal(cancelTaskTree(db, "root", "later"), 2);
  assert.deepEqual([...db.prepare("SELECT status FROM tasks ORDER BY id").all()].map((row) => row.status), ["cancelled", "cancelled"]);
  assert.equal(deleteTerminalTaskTree(db, "root"), 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 0);
});

test("active task trees cannot be deleted", () => {
  const db = fixture();
  assert.throws(() => deleteTerminalTaskTree(db, "root"), /Cancel the task/);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 2);
});

test("terminal roots with backlog descendants cannot be deleted", () => {
  const db = fixture();
  db.prepare("UPDATE tasks SET status='cancelled',claimed_at=NULL WHERE id='root'").run();
  db.prepare("UPDATE tasks SET status='backlog' WHERE id='child'").run();

  assert.throws(() => deleteTerminalTaskTree(db, "root"), /Cancel remaining work/);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tasks").get().count, 2);
  db.close();
});

test("terminal roots retain active descendants until all reachable work is terminal", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT, source TEXT, assignee TEXT, topic TEXT, status TEXT,
    claimed_at TEXT, completed_at TEXT
  );
  CREATE TABLE root_task_policy(singleton INTEGER PRIMARY KEY,max_active_tasks INTEGER NOT NULL,leader TEXT NOT NULL);
  INSERT INTO root_task_policy VALUES(1,0,'lead')`);
  const insert = db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,NULL)");
  insert.run("root", null, "root", "manual", "lead", "work-item", "failed", null);
  insert.run("child", "root", "delegation", "agent", "worker", "delegate", "claimed", "now");
  insert.run("grandchild", "child", "delegation", "agent", "worker", "delegate", "deferred", null);
  insert.run("unrelated", null, "root", "manual", "lead", "work-item", "completed", null);
  const before = db.prepare("SELECT id,parent_id,status,claimed_at FROM tasks ORDER BY id").all().map((row) => ({ ...row }));

  assert.throws(() => deleteTerminalTaskTree(db, "root"), /Cancel remaining work/);
  assert.deepEqual(db.prepare("SELECT id,parent_id,status,claimed_at FROM tasks ORDER BY id").all().map((row) => ({ ...row })), before);

  db.exec("UPDATE tasks SET status='completed',claimed_at=NULL WHERE id='child'; UPDATE tasks SET status='cancelled' WHERE id='grandchild'");
  assert.equal(deleteTerminalTaskTree(db, "root"), 3);
  assert.deepEqual(db.prepare("SELECT id,status FROM tasks").all().map((row) => ({ ...row })), [
    { id: "unrelated", status: "completed" },
  ]);
  db.close();
});

test("cancelling the final child requeues its waiting parent", () => {
  const db = fixture();
  db.prepare("UPDATE tasks SET status='waiting',claimed_at=NULL WHERE id='root'").run();
  assert.equal(cancelTaskTree(db, "child", "later"), 1);
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='root'").get().status, "pending");
});

test("cancelling active agent work promotes its oldest buffered delegation", () => {
  const db = fixture();
  db.prepare(`INSERT INTO tasks(
    id,parent_id,kind,source,assignee,topic,status,claimed_at,completed_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run("buffered", "root", "delegation", "agent", "worker", "next", "buffered", null, null);
  db.prepare("UPDATE tasks SET assignee='worker',status='claimed' WHERE id='child'").run();

  assert.equal(cancelTaskTree(db, "child", "later"), 1);

  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='buffered'").get().status, "pending");
  db.close();
});

test("cancelling an active root promotes the oldest project backlog task", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT, source TEXT, assignee TEXT, topic TEXT, status TEXT,
    claimed_at TEXT, completed_at TEXT, created_at TEXT
  );
  CREATE TABLE root_task_policy(singleton INTEGER PRIMARY KEY, max_active_tasks INTEGER NOT NULL,leader TEXT NOT NULL);
  INSERT INTO root_task_policy VALUES(1,2,'lead');`);
  const insert = db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)");
  insert.run("active-one", null, "root", "manual", "lead", "work-item", "claimed", "now", null, "1");
  insert.run("active-two", null, "root", "manual", "lead", "work-item", "pending", null, null, "2");
  insert.run("backlog-one", null, "root", "manual", "lead", "work-item", "backlog", null, null, "3");
  insert.run("backlog-two", null, "root", "manual", "lead", "work-item", "backlog", null, null, "4");

  assert.equal(cancelTaskTree(db, "active-one", "later"), 1);
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='backlog-one'").get().status, "pending");
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='backlog-two'").get().status, "backlog");
  db.close();
});

test("deleting a terminal root promotes the oldest project backlog task", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT, source TEXT, assignee TEXT, topic TEXT, status TEXT,
    claimed_at TEXT, completed_at TEXT, created_at TEXT
  );
  CREATE TABLE root_task_policy(singleton INTEGER PRIMARY KEY, max_active_tasks INTEGER NOT NULL,leader TEXT NOT NULL);
  INSERT INTO root_task_policy VALUES(1,1,'lead');`);
  const insert = db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)");
  insert.run("completed-root", null, "root", "manual", "lead", "work-item", "completed", null, "2", "1");
  insert.run("backlog-one", null, "root", "manual", "lead", "work-item", "backlog", null, null, "2");
  insert.run("backlog-two", null, "root", "manual", "lead", "work-item", "backlog", null, null, "3");

  assert.equal(deleteTerminalTaskTree(db, "completed-root"), 1);
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='backlog-one'").get().status, "pending");
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='backlog-two'").get().status, "backlog");
  db.close();
});

test("cyclic task trees cancel and delete each reachable task once", () => {
  const cancelDb = cyclicFixture("claimed", "deferred", "completed");
  assert.equal(cancelTaskTree(cancelDb, "root", "later"), 2);
  assert.deepEqual(cancelDb.prepare("SELECT id,status,completed_at FROM tasks ORDER BY id").all().map((row) => ({ ...row })), [
    { id: "child", status: "cancelled", completed_at: "later" },
    { id: "grandchild", status: "completed", completed_at: null },
    { id: "root", status: "cancelled", completed_at: "later" },
    { id: "unrelated", status: "claimed", completed_at: null },
  ]);
  cancelDb.close();

  const deleteDb = cyclicFixture("cancelled", "completed", "failed");
  assert.equal(deleteTerminalTaskTree(deleteDb, "root"), 3);
  assert.deepEqual(deleteDb.prepare("SELECT id,status FROM tasks").all().map((row) => ({ ...row })), [
    { id: "unrelated", status: "claimed" },
  ]);
  deleteDb.close();
});

test("cancellation preserves failures and waits for buffered siblings", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT, status TEXT,
    claimed_at TEXT, completed_at TEXT, error TEXT
  )`);
  const insert = db.prepare(`INSERT INTO tasks(
    id,parent_id,kind,status,claimed_at,completed_at,error
  ) VALUES(?,?,?,?,?,?,?)`);
  insert.run("parent", null, "root", "waiting", null, null, null);
  insert.run("target", "parent", "root", "pending", null, null, null);
  insert.run("failed-child", "target", "delegation", "failed", null, "failed-at", "Original failure");
  insert.run("active-child", "target", "delegation", "claimed", "claimed-at", null, null);
  insert.run("buffered-sibling", "parent", "delegation", "buffered", null, null, null);
  insert.run("raced-root", null, "root", "failed", null, "race-failed-at", "Race failure");

  assert.equal(cancelTaskTree(db, "target", "cancelled-at"), 2);
  assert.deepEqual({ ...db.prepare("SELECT status,error,completed_at FROM tasks WHERE id='failed-child'").get() }, {
    status: "failed",
    error: "Original failure",
    completed_at: "failed-at",
  });
  assert.deepEqual({ ...db.prepare("SELECT status,claimed_at,completed_at FROM tasks WHERE id='active-child'").get() }, {
    status: "cancelled",
    claimed_at: null,
    completed_at: "cancelled-at",
  });
  assert.deepEqual({ ...db.prepare("SELECT status,completed_at FROM tasks WHERE id='target'").get() }, {
    status: "cancelled",
    completed_at: "cancelled-at",
  });
  assert.equal(cancelTaskTree(db, "target", "second-cancel-at"), 0);
  assert.deepEqual(db.prepare("SELECT id,completed_at FROM tasks WHERE id IN ('target','active-child') ORDER BY id").all().map((row) => ({ ...row })), [
    { id: "active-child", completed_at: "cancelled-at" },
    { id: "target", completed_at: "cancelled-at" },
  ]);
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='parent'").get().status, "waiting");

  assert.equal(cancelTaskTree(db, "raced-root", "later"), 0);
  assert.deepEqual({ ...db.prepare("SELECT status,error,completed_at FROM tasks WHERE id='raced-root'").get() }, {
    status: "failed",
    error: "Race failure",
    completed_at: "race-failed-at",
  });

  assert.equal(cancelTaskTree(db, "buffered-sibling", "buffer-cancelled-at"), 1);
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='parent'").get().status, "pending");
  db.close();
});

function cyclicFixture(rootStatus, childStatus, grandchildStatus) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT, status TEXT,
    claimed_at TEXT, completed_at TEXT
  )`);
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,NULL)").run("root", null, "root", rootStatus, "now");
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,NULL)").run("child", "root", "delegation", childStatus, null);
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,NULL)").run("grandchild", "child", "delegation", grandchildStatus, null);
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,NULL)").run("unrelated", null, "root", "claimed", "now");
  db.prepare("UPDATE tasks SET parent_id='grandchild' WHERE id='root'").run();
  return db;
}
