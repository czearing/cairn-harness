import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const {
  completeAgentDeletionOperation,
  deleteAgent,
  previewAgentDeletion,
} = await import("../src/server/mutations.ts");
const { writeProjectConfig } = await import("../src/server/project-config-write.ts");
const {
  handleAgentDelete,
} = await import("../src/app/api/projects/[projectId]/agents/[agentId]/route.ts");

test("agent deletion reports durable cleanup attention after restart failure", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-agent-delete-"));
  const projectId = "example-project";
  const projectDirectory = path.join(root, projectId);
  const configPath = path.join(projectDirectory, "project.json");
  const previousProjects = process.env.HARNESS_PROJECTS;
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
  });

  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({
    name: "Example",
    root,
    leader: "lead",
    producer: "builder",
    roles: [
      { name: "lead", description: "Lead", prompt: "Lead." },
      { name: "builder", description: "Build", prompt: "Build." },
    ],
  }, null, 2)}\n`);
  process.env.HARNESS_PROJECTS = configPath;

  const restartError = new Error("worker restart failed");
  const restartCalls = [];
  const success = handleAgentDelete(projectId, "builder", 0, "delete-builder", {
    deleteAgent: (id, agent, options) => deleteAgent(id, agent, options),
    restartProject: (restartProjectId) => {
      restartCalls.push(restartProjectId);
      throw restartError;
    },
    completeOperation: completeAgentDeletionOperation,
  });

  assert.equal(success.status, 202);
  const cleanup = await success.json();
  assert.equal(cleanup.code, "cleanup_attention");
  assert.equal(cleanup.revision, 1);
  assert.equal(cleanup.detail, restartError.message);
  assert.equal(typeof cleanup.operationId, "string");
  const persisted = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(persisted.roles.map((role) => role.name), ["lead"]);
  assert.equal("producer" in persisted, false);
  assert.deepEqual(persisted.agent_deletion_operations, [{
    id: cleanup.operationId,
    idempotencyKey: "delete-builder",
    targetId: "builder",
    targetKind: "source",
    affectedIds: ["builder"],
    state: "cleanup_attention",
    revision: 1,
    error: restartError.message,
  }]);
  assert.deepEqual(restartCalls, [projectId]);

  const retry = handleAgentDelete(projectId, "builder", 1, "delete-builder", {
    deleteAgent: (id, agent, options) => deleteAgent(id, agent, options),
    restartProject: (restartProjectId) => restartCalls.push(restartProjectId),
    completeOperation: completeAgentDeletionOperation,
  });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), {
    ok: true,
    revision: 1,
    operationId: cleanup.operationId,
  });
  const reconciled = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(reconciled.agent_deletion_operations[0].state, "completed");
  assert.equal(reconciled.agent_deletion_operations[0].error, undefined);
  assert.deepEqual(restartCalls, [projectId, projectId]);

  let failedRestartCalls = 0;
  const persistenceError = new Error("config write failed");
  const failure = handleAgentDelete(projectId, "lead", 1, "delete-lead", {
    deleteAgent: () => { throw persistenceError; },
    restartProject: () => { failedRestartCalls += 1; },
    completeOperation: completeAgentDeletionOperation,
  });

  assert.equal(failure.status, 400);
  assert.deepEqual(await failure.json(), { error: persistenceError.message });
  assert.equal(failedRestartCalls, 0);
});

test("agent deletion rejects active ownership and holds its exclusion boundary through config persistence", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-agent-delete-work-"));
  const projectId = "active-work-project";
  const projectDirectory = path.join(root, projectId);
  const workspace = path.join(root, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  const databasePath = path.join(harnessDirectory, "harness.db");
  const previousProjects = process.env.HARNESS_PROJECTS;
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
  });

  mkdirSync(projectDirectory, { recursive: true });
  mkdirSync(harnessDirectory, { recursive: true });
  const originalConfig = `${JSON.stringify({
    name: "Active work",
    root: workspace,
    leader: "lead",
    producer: "builder",
    roles: [
      { name: "lead", description: "Lead", prompt: "Lead." },
      { name: "builder", description: "Build", prompt: "Build." },
      { name: "other", description: "Other", prompt: "Other." },
    ],
  }, null, 2)}\n`;
  writeFileSync(configPath, originalConfig);
  process.env.HARNESS_PROJECTS = configPath;
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT,status TEXT,error TEXT)");
  const insert = db.prepare("INSERT INTO tasks VALUES(?,?,?,?)");
  insert.run("active-builder", "builder", "pending", null);
  insert.run("failed-builder", "builder", "failed", "Preserve failure diagnostic");
  insert.run("cancelled-builder", "builder", "cancelled", "Preserve cancellation diagnostic");
  insert.run("active-other", "other", "claimed", "Other agent work");
  db.close();

  let restartCalls = 0;
  const activeResponse = handleAgentDelete(projectId, "builder", 0, "active-builder", {
    deleteAgent: (id, agent, options) => deleteAgent(id, agent, options),
    restartProject: () => { restartCalls += 1; },
    completeOperation: completeAgentDeletionOperation,
  });
  assert.equal(activeResponse.status, 400);
  assert.match((await activeResponse.json()).error, /finish or cancel/i);
  assert.equal(readFileSync(configPath, "utf8"), originalConfig);
  assert.deepEqual(readTasks(databasePath), [
    { id: "active-builder", assignee: "builder", status: "pending", error: null },
    { id: "active-other", assignee: "other", status: "claimed", error: "Other agent work" },
    { id: "cancelled-builder", assignee: "builder", status: "cancelled", error: "Preserve cancellation diagnostic" },
    { id: "failed-builder", assignee: "builder", status: "failed", error: "Preserve failure diagnostic" },
  ]);
  assert.equal(restartCalls, 0);

  const leaderResponse = handleAgentDelete(projectId, "lead", 0, "delete-lead", {
    deleteAgent: (id, agent, options) => deleteAgent(id, agent, options),
    restartProject: () => { restartCalls += 1; },
    completeOperation: completeAgentDeletionOperation,
  });
  assert.equal(leaderResponse.status, 400);
  assert.deepEqual(await leaderResponse.json(), { error: "Reassign leadership before deleting this agent" });
  assert.equal(restartCalls, 0);

  const updateDb = new DatabaseSync(databasePath);
  updateDb.prepare("UPDATE tasks SET status='completed' WHERE id='active-builder'").run();
  updateDb.close();
  const persistenceError = new Error("injected config persistence failure");
  const persistenceResponse = handleAgentDelete(projectId, "builder", 0, "persistence-failure", {
    deleteAgent: (id, agent, options) => deleteAgent(id, agent, {
      ...options,
      writeProjectConfig: () => { throw persistenceError; },
    }),
    restartProject: () => { restartCalls += 1; },
    completeOperation: completeAgentDeletionOperation,
  });
  assert.equal(persistenceResponse.status, 400);
  assert.deepEqual(await persistenceResponse.json(), { error: persistenceError.message });
  assert.equal(readFileSync(configPath, "utf8"), originalConfig);
  assert.equal(restartCalls, 0);

  const concurrentDb = new DatabaseSync(databasePath);
  concurrentDb.exec("PRAGMA busy_timeout=0");
  concurrentDb.prepare("INSERT INTO tasks VALUES('after-rollback','builder','completed','Historical row')").run();
  let blockedConcurrentInsert = false;
  const successResponse = handleAgentDelete(projectId, "builder", 0, "delete-builder", {
    deleteAgent: (id, agent, options) => deleteAgent(id, agent, {
      ...options,
      writeProjectConfig: (file, config) => {
        assert.throws(
          () => concurrentDb.prepare("INSERT INTO tasks VALUES('racing-active','builder','pending',NULL)").run(),
          /locked|busy/i,
        );
        blockedConcurrentInsert = true;
        writeProjectConfig(file, config);
      },
    }),
    restartProject: () => { restartCalls += 1; },
    completeOperation: completeAgentDeletionOperation,
  });
  concurrentDb.close();

  assert.equal(successResponse.status, 200);
  const success = await successResponse.json();
  assert.equal(success.ok, true);
  assert.equal(success.revision, 1);
  assert.equal(typeof success.operationId, "string");
  assert.equal(blockedConcurrentInsert, true);
  assert.equal(restartCalls, 1);
  const persisted = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(persisted.roles.map((role) => role.name), ["lead", "other"]);
  assert.equal("producer" in persisted, false);
  assert.deepEqual(readTasks(databasePath), [
    { id: "active-builder", assignee: "builder", status: "completed", error: null },
    { id: "active-other", assignee: "other", status: "claimed", error: "Other agent work" },
    { id: "after-rollback", assignee: "builder", status: "completed", error: "Historical row" },
    { id: "cancelled-builder", assignee: "builder", status: "cancelled", error: "Preserve cancellation diagnostic" },
    { id: "failed-builder", assignee: "builder", status: "failed", error: "Preserve failure diagnostic" },
  ]);
});

test("deleting a source removes its complete local-copy group while retaining history", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-source-delete-"));
  const projectId = "source-delete";
  const projectDirectory = path.join(root, projectId);
  const workspace = path.join(root, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  const databasePath = path.join(harnessDirectory, "harness.db");
  const previousProjects = process.env.HARNESS_PROJECTS;
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
  });

  test("deletion preview returns the exact source group and every lifecycle blocker", (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "harness-source-preview-"));
    const projectId = "source-preview";
    const projectDirectory = path.join(root, projectId);
    const workspace = path.join(root, "workspace");
    const harnessDirectory = path.join(workspace, ".cairn-harness");
    const configPath = path.join(projectDirectory, "project.json");
    const databasePath = path.join(harnessDirectory, "harness.db");
    const previousProjects = process.env.HARNESS_PROJECTS;
    context.after(() => {
      rmSync(root, { recursive: true, force: true });
      restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    });
    mkdirSync(projectDirectory, { recursive: true });
    mkdirSync(harnessDirectory, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({
      name: "Source preview",
      root: workspace,
      leader: "lead",
      configuration_revision: 7,
      roles: [
        { name: "lead", description: "Lead", prompt: "Lead." },
        { name: "dev", agent_kind: "source", source_agent: "dev", instance_ordinal: 0, description: "Build", prompt: "Build." },
        { name: "dev-2", agent_kind: "local", source_agent: "dev", instance_ordinal: 1, description: "Build", prompt: "Build." },
      ],
    }, null, 2)}\n`);
    process.env.HARNESS_PROJECTS = configPath;
    const db = new DatabaseSync(databasePath);
    db.exec(`CREATE TABLE agents(agent_id TEXT,status TEXT,current_topic TEXT);
      CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT,status TEXT);
      INSERT INTO agents VALUES('dev','idle',NULL),('dev-2','working','Active copy claim');
      INSERT INTO tasks VALUES('buffered-copy','dev-2','buffered'),('historic','dev','completed')`);
    db.close();

    assert.deepEqual(previewAgentDeletion(projectId, "dev"), {
      revision: 7,
      targetId: "dev",
      targetKind: "source",
      affected: [
        { id: "dev", kind: "source", status: "idle", currentClaim: undefined },
        { id: "dev-2", kind: "local", status: "working", currentClaim: "Active copy claim" },
      ],
      blockers: [{ code: "active_work", agentId: "dev-2", status: "buffered", claimId: "buffered-copy" }],
      canDelete: false,
    });
  });
  mkdirSync(projectDirectory, { recursive: true });
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({
    name: "Source delete",
    root: workspace,
    leader: "lead",
    roles: [
      { name: "lead", description: "Lead", prompt: "Lead." },
      { name: "dev", agent_kind: "source", source_agent: "dev", instance_ordinal: 0, description: "Build", prompt: "Build." },
      { name: "dev-2", agent_kind: "local", source_agent: "dev", instance_ordinal: 1, description: "Build", prompt: "Build." },
      { name: "other", description: "Other", prompt: "Other." },
    ],
  }, null, 2)}\n`);
  process.env.HARNESS_PROJECTS = configPath;
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT,status TEXT,error TEXT)");
  db.prepare("INSERT INTO tasks VALUES('historic','dev-2','completed','Retained')").run();
  db.close();

  deleteAgent(projectId, "dev");
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).roles.map((role) => role.name), ["lead", "other"]);
  assert.deepEqual(readTasks(databasePath), [
    { id: "historic", assignee: "dev-2", status: "completed", error: "Retained" },
  ]);
});

function readTasks(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare("SELECT id,assignee,status,error FROM tasks ORDER BY id").all().map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
