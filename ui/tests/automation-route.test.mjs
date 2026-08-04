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

const { updateAutomation } = await import("../src/server/automation-mutations.ts");
const { handleAutomationPut } = await import("../src/app/api/projects/[projectId]/automation/route.ts");

test("automation restart failures reach the response after persisting desired config", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-automation-route-"));
  const projectId = "automation-project";
  const projectDirectory = path.join(root, projectId);
  const configPath = path.join(projectDirectory, "project.json");
  const previousProjects = process.env.HARNESS_PROJECTS;
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
    if (previousProjects === undefined) delete process.env.HARNESS_PROJECTS;
    else process.env.HARNESS_PROJECTS = previousProjects;
  });

  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({
    name: "Automation project",
    root,
    roles: [{ name: "ideas", description: "Ideas", prompt: "Create ideas." }],
  }, null, 2)}\n`);
  process.env.HARNESS_PROJECTS = configPath;
  const restartError = new Error("worker restart failed");
  const restartCalls = [];
  const request = new Request(`http://localhost/api/projects/${projectId}/automation`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      maxActiveTasks: 2,
      ideaAgents: [{ agentId: "ideas", taskLimit: 3, prompt: "Create useful work." }],
    }),
  });

  const response = await handleAutomationPut(request, projectId, (...arguments_) =>
    updateAutomation(...arguments_, {
      restartProject: (restartProjectId) => {
        restartCalls.push(restartProjectId);
        throw restartError;
      },
    }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: restartError.message, persisted: true });
  assert.deepEqual(restartCalls, [projectId]);
  const persisted = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal("leader_task_limit" in persisted, false);
  assert.equal(persisted.max_active_tasks, 2);
  assert.deepEqual(persisted.idea_agents, [{ agent: "ideas", task_limit: 3, prompt: "Create useful work." }]);
});

test("automation persistence failures remain ordinary request failures", async () => {
  const persistenceError = new Error("config write failed");
  const request = new Request("http://localhost/api/projects/automation-project/automation", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxActiveTasks: 2, ideaAgents: [] }),
  });

  const response = await handleAutomationPut(request, "automation-project", () => {
    throw persistenceError;
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: persistenceError.message });
});

test("automation settings upgrade a legacy project database before restart", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-automation-upgrade-"));
  const projectId = "legacy-project";
  const projectDirectory = path.join(root, projectId);
  const workspace = path.join(root, "workspace");
  const configPath = path.join(projectDirectory, "project.json");
  const databasePath = path.join(workspace, ".cairn-harness", "harness.db");
  const previousProjects = process.env.HARNESS_PROJECTS;
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
    if (previousProjects === undefined) delete process.env.HARNESS_PROJECTS;
    else process.env.HARNESS_PROJECTS = previousProjects;
  });

  mkdirSync(path.dirname(databasePath), { recursive: true });
  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({
    name: "Legacy project",
    root: workspace,
    leader: "lead",
    roles: [{ name: "lead", description: "Lead", prompt: "Lead." }],
  }, null, 2)}\n`);
  process.env.HARNESS_PROJECTS = configPath;
  const db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE tasks(
    id TEXT PRIMARY KEY,parent_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,
    topic TEXT,body TEXT,status TEXT,created_at TEXT
  )`);
  const insert = db.prepare("INSERT INTO tasks VALUES(?,NULL,'root','manual','dashboard','lead','work-item',?,'pending',?)");
  insert.run("one", "One", "1");
  insert.run("two", "Two", "2");
  db.close();

  const result = updateAutomation(projectId, {
    maxActiveTasks: 1,
    ideaAgents: [],
  }, { restartProject: () => {} });

  assert.deepEqual(result, { persisted: true });
  const upgraded = new DatabaseSync(databasePath);
  assert.deepEqual({ ...upgraded.prepare("SELECT max_active_tasks,leader FROM root_task_policy").get() }, {
    max_active_tasks: 1,
    leader: "lead",
  });
  assert.deepEqual(upgraded.prepare("SELECT id,status FROM tasks ORDER BY id").all().map((row) => ({ ...row })), [
    { id: "one", status: "pending" },
    { id: "two", status: "backlog" },
  ]);
  upgraded.close();
});
