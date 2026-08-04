import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createConversationVersionReader } from "../src/server/project-conversation-versions.ts";

register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/project-conversation-versions") || specifier.endsWith("/project-event-path")) {
      return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  }
`)}`);
const { createProjectEventSubscriber } = await import("../src/server/project-events.ts");

test("existing project watcher uses refreshed project metadata", async () => {
  let watchCount = 0;
  let watched;
  const versions = new Map([["agent-a", "a1"], ["agent-b", "b1"]]);
  const versionProjects = [];
  const subscribe = createProjectEventSubscriber({
    watchProject: (_root, listener) => {
      watchCount += 1;
      watched = listener;
      return { close() {} };
    },
    conversationVersions: (project) => {
      versionProjects.push({
        id: project.id,
        workDir: project.workDir,
        agents: project.agents.map((agent) => agent.id),
      });
      return new Map(project.agents.map((agent) => [agent.id, versions.get(agent.id) || ""]));
    },
  });
  const events = [];
  const listener = (event) => events.push(event);

  subscribe([project("old-project", "old-work", ["agent-a"])], listener);
  subscribe([project("new-project", "new-work", ["agent-a", "agent-b"])], listener);
  assert.equal(watchCount, 1);

  watched("change", "new-work/item.md");
  await Promise.resolve();
  watched("change", ".cairn-harness/live-responses/agent-b.json");
  await Promise.resolve();
  assert.deepEqual(events.at(-1), { projectId: "new-project", conversations: ["agent-b"] });
  watched("change", ".cairn-harness/copilot-home/agent-a/session-state/session-one/events.jsonl");
  await Promise.resolve();
  assert.deepEqual(events.at(-1), { projectId: "new-project", conversations: ["agent-a"] });
  versions.set("agent-b", "b2");
  watched("change", ".cairn-harness/harness.db-wal");
  watched("change", ".cairn-harness/harness.db-wal");
  await Promise.resolve();

  assert.deepEqual(events[0], { projectId: "new-project", conversations: [] });
  assert.deepEqual(events.filter((event) => event.conversations.includes("agent-b")), [
    { projectId: "new-project", conversations: ["agent-b"] },
    { projectId: "new-project", conversations: ["agent-b"] },
  ]);
  versions.set("agent-a", "a2");
  watched("change", ".cairn-harness/harness.db-wal");
  watched("change", ".cairn-harness/harness.db-wal");
  await Promise.resolve();
  assert.deepEqual(events.filter((event) => event.conversations.includes("agent-a")), [
    { projectId: "new-project", conversations: ["agent-a"] },
    { projectId: "new-project", conversations: ["agent-a"] },
  ]);
  assert.equal(watchCount, 1);
  assert.deepEqual(versionProjects.at(-1), {
    id: "new-project",
    workDir: "new-work",
    agents: ["agent-a", "agent-b"],
  });
});

test("watcher creation and runtime failures are reported as degraded", () => {
  const failures = [];
  const failedSubscribe = createProjectEventSubscriber({
    watchProject: () => { throw new Error("watch unavailable"); },
    conversationVersions: () => new Map(),
  });
  failedSubscribe([project("failed-project", "work-items", [])], () => {}, () => failures.push("create"));

  let watcher;
  const runtimeSubscribe = createProjectEventSubscriber({
    watchProject: () => {
      watcher = {
        close() {},
        on(event, listener) {
          if (event === "error") this.fail = listener;
        },
      };
      return watcher;
    },
    conversationVersions: () => new Map(),
  });
  runtimeSubscribe([project("runtime-project", "work-items", [])], () => {}, () => failures.push("runtime"));
  watcher.fail();

  assert.deepEqual(failures, ["create", "runtime"]);
});

test("project watchers close when their final subscription releases", async () => {
  const watchers = new Map();
  const versions = new Map([["agent-a", "a1"]]);
  const subscribe = createProjectEventSubscriber({
    watchProject: (root, listener) => {
      const watcher = { listener, closes: 0, close() { watcher.closes += 1; } };
      const rootWatchers = watchers.get(root) || [];
      rootWatchers.push(watcher);
      watchers.set(root, rootWatchers);
      return watcher;
    },
    conversationVersions: (current) =>
      new Map(current.agents.map((agent) => [agent.id, versions.get(agent.id) || ""])),
  });
  const root = "C:\\workspace";
  const staleRoot = "C:\\stale-workspace";
  const firstEvents = [];
  const secondEvents = [];
  const firstListener = (event) => firstEvents.push(event);
  const releaseInitialFirst = subscribe([
    project("project-a", "work-items", ["agent-a"]),
    { ...project("stale-project", "work-items", ["agent-a"]), root: staleRoot },
  ], firstListener);
  const releaseSecond = subscribe(
    [project("project-a", "work-items", ["agent-a"])],
    (event) => secondEvents.push(event),
  );
  assert.equal(watchers.get(root).length, 1);
  assert.equal(watchers.get(staleRoot).length, 1);

  const releaseFirst = subscribe(
    [project("project-a-refreshed", "current-work", ["agent-a"])],
    firstListener,
  );
  assert.equal(watchers.get(staleRoot)[0].closes, 1);
  watchers.get(staleRoot)[0].listener("change", "work-items/after-reconcile.md");
  await Promise.resolve();
  assert.deepEqual(firstEvents, []);
  assert.equal(watchers.get(root)[0].closes, 0);
  releaseInitialFirst();
  assert.equal(watchers.get(root)[0].closes, 0);
  releaseFirst();
  assert.equal(watchers.get(root)[0].closes, 0);
  watchers.get(root)[0].listener("change", "work-items/queued.md");
  releaseSecond();
  assert.equal(watchers.get(root)[0].closes, 1);
  watchers.get(root)[0].listener("change", "work-items/after-release.md");
  await Promise.resolve();
  assert.deepEqual(secondEvents, []);

  versions.set("agent-a", "a2");
  const freshEvents = [];
  const releaseFresh = subscribe(
    [project("project-a-fresh", "fresh-work", ["agent-a"])],
    (event) => freshEvents.push(event),
  );
  assert.equal(watchers.get(root).length, 2);
  watchers.get(root)[1].listener("change", ".cairn-harness/harness.db-wal");
  await Promise.resolve();
  assert.deepEqual(freshEvents, [{ projectId: "project-a-fresh", conversations: [] }]);
  versions.set("agent-a", "a3");
  watchers.get(root)[1].listener("change", ".cairn-harness/harness.db-wal");
  await Promise.resolve();
  assert.deepEqual(freshEvents.at(-1), { projectId: "project-a-fresh", conversations: ["agent-a"] });
  releaseFresh();
  assert.equal(watchers.get(root)[1].closes, 1);
});

test("one live listener reconciles added and removed project memberships", async () => {
  const watchers = new Map();
  const versions = new Map([
    ["project-a", new Map([["agent-a", "a1"]])],
    ["project-b", new Map([["agent-b", "b1"]])],
  ]);
  const subscribe = createProjectEventSubscriber({
    watchProject: (root, listener) => {
      const watcher = { listener, closes: 0, close() { watcher.closes += 1; } };
      watchers.set(root, watcher);
      return watcher;
    },
    conversationVersions: (current) => new Map(versions.get(current.id) || []),
  });
  const rootA = "C:\\workspace-a";
  const rootB = "C:\\workspace-b";
  const projectA = { ...project("project-a", "work-items", ["agent-a"]), root: rootA };
  const projectB = { ...project("project-b", "work-items", ["agent-b"]), root: rootB };
  const events = [];
  const listener = (event) => events.push(event);

  const releaseInitial = subscribe([projectA], listener);
  const releaseExpanded = subscribe([projectA, projectB], listener);
  assert.equal(watchers.size, 2);
  assert.equal(watchers.get(rootA).closes, 0);
  assert.equal(watchers.get(rootB).closes, 0);

  watchers.get(rootB).listener("change", ".cairn-harness/harness.db-wal");
  await Promise.resolve();
  assert.deepEqual(events, [{ projectId: "project-b", conversations: [] }]);

  versions.get("project-b").set("agent-b", "b2");
  watchers.get(rootB).listener("change", ".cairn-harness/harness.db-wal");
  watchers.get(rootB).listener("change", ".cairn-harness/harness.db-wal");
  await Promise.resolve();
  assert.deepEqual(events.filter((event) => event.conversations.length), [
    { projectId: "project-b", conversations: ["agent-b"] },
  ]);

  const releaseCurrent = subscribe([projectB], listener);
  assert.equal(watchers.get(rootA).closes, 1);
  assert.equal(watchers.get(rootB).closes, 0);
  releaseInitial();
  releaseExpanded();
  assert.equal(watchers.get(rootB).closes, 0);
  releaseCurrent();
  assert.equal(watchers.get(rootB).closes, 1);
});

test("conversation versions batch configured agents and emit only changed conversations", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-project-event-versions-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const harness = path.join(root, ".cairn-harness");
  const database = path.join(harness, "harness.db");
  mkdirSync(harness);
  const agents = Array.from({ length: 52 }, (_, index) => `agent-${index}`);
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE tasks(creator TEXT,assignee TEXT,created_at TEXT);
    CREATE TABLE turns(agent_id TEXT,completed_at TEXT);
    CREATE TABLE context_resets(agent_id TEXT,cleared_at TEXT);
    INSERT INTO tasks VALUES('dashboard','agent-0','task-only');
    INSERT INTO turns VALUES('agent-1','turn-only');
    INSERT INTO context_resets VALUES('agent-2','reset-only');
    INSERT INTO tasks VALUES('agent-3','team','task-all');
    INSERT INTO turns VALUES('agent-3','turn-all');
    INSERT INTO context_resets VALUES('agent-3','reset-all');
  `);
  db.close();
  const sessions = [];
  const versionQueries = [
    "conversation-task-versions",
    "conversation-turn-versions",
    "conversation-reset-versions",
  ];
  const readVersions = createConversationVersionReader((file) => {
    const actual = new DatabaseSync(file, { readOnly: true });
    const session = { prepares: 0, closes: 0, queries: [] };
    sessions.push(session);
    return {
      prepare(sql) {
        session.prepares += 1;
        session.queries.push(versionQueries.find((query) => sql.includes(query)));
        return actual.prepare(sql);
      },
      close() {
        session.closes += 1;
        actual.close();
      },
    };
  });
  const current = { ...project("batch-project", "work-items", agents), root };

  const initial = readVersions(current);
  assert.equal(initial.get("agent-0"), "task-only||");
  assert.equal(initial.get("agent-1"), "|turn-only|");
  assert.equal(initial.get("agent-2"), "||reset-only");
  assert.equal(initial.get("agent-3"), "task-all|turn-all|reset-all");
  assert.equal(initial.get("agent-4"), "||");
  assert.deepEqual(sessions[0], { prepares: 3, closes: 1, queries: versionQueries });

  let watched;
  const events = [];
  const subscribe = createProjectEventSubscriber({
    watchProject: (_root, listener) => {
      watched = listener;
      return { close() {} };
    },
    conversationVersions: readVersions,
  });
  subscribe([current], (event) => events.push(event));
  assert.deepEqual(sessions[1], { prepares: 3, closes: 1, queries: versionQueries });
  const changed = new DatabaseSync(database);
  changed.exec(`
    INSERT INTO tasks VALUES('dashboard','agent-5','task-changed');
    INSERT INTO turns VALUES('agent-6','turn-changed');
  `);
  changed.close();

  watched("change", ".cairn-harness/harness.db-wal");
  await Promise.resolve();
  assert.deepEqual(events, [{ projectId: "batch-project", conversations: ["agent-5", "agent-6"] }]);
  assert.deepEqual(sessions[2], { prepares: 3, closes: 1, queries: versionQueries });

  const legacyRoot = path.join(root, "legacy");
  const legacyHarness = path.join(legacyRoot, ".cairn-harness");
  mkdirSync(legacyHarness, { recursive: true });
  const legacyDb = new DatabaseSync(path.join(legacyHarness, "harness.db"));
  legacyDb.exec(`
    CREATE TABLE tasks(creator TEXT,assignee TEXT,created_at TEXT);
    CREATE TABLE turns(agent_id TEXT,completed_at TEXT);
    INSERT INTO tasks VALUES('dashboard','agent-0','legacy-task');
    INSERT INTO turns VALUES('agent-1','legacy-turn');
  `);
  legacyDb.close();
  const legacy = readVersions({ ...current, root: legacyRoot });
  assert.equal(legacy.get("agent-0"), "legacy-task||");
  assert.equal(legacy.get("agent-1"), "|legacy-turn|");
  assert.equal(legacy.get("agent-2"), "||");
  assert.deepEqual(sessions[3], { prepares: 3, closes: 1, queries: versionQueries });
  assert.ok(sessions.every((session) => session.closes === 1));
});

function project(id, workDir, agents) {
  return {
    id,
    root: "C:\\workspace",
    workDir,
    agents: agents.map((agentId) => ({ id: agentId })),
  };
}
