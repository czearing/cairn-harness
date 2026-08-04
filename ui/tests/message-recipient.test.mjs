import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const supervisorShim = "test:message-recipient-supervisor";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./supervisor" && context.parentURL?.includes("/src/server/")) {
      return { url: supervisorShim, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === supervisorShim) return {
      format: "module",
      shortCircuit: true,
      source: `
        export const ensureProjectRunning = (id) => globalThis.__messageRecipientStart(id);
        export const restartProject = () => {};
      `,
    };
    return nextLoad(url, context);
  },
});

const { POST } = await import("../src/app/api/projects/[projectId]/messages/route.ts");

test("message recipients must belong to the fresh selected project roster", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-message-recipient-"));
  const previousProjects = process.env.HARNESS_PROJECTS;
  const previousProjectRoot = process.env.HARNESS_PROJECT_ROOT;
  const previousExamples = process.env.HARNESS_DISCOVER_EXAMPLES;
  context.after(() => {
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    restoreEnvironment("HARNESS_PROJECT_ROOT", previousProjectRoot);
    restoreEnvironment("HARNESS_DISCOVER_EXAMPLES", previousExamples);
    delete globalThis.__messageRecipientStart;
    rmSync(root, { recursive: true, force: true });
  });

  const alpha = createProject(root, "alpha", "alpha-agent");
  const beta = createProject(root, "beta", "beta-agent");
  process.env.HARNESS_PROJECTS = [alpha.config, beta.config].join(path.delimiter);
  process.env.HARNESS_PROJECT_ROOT = path.join(root, "managed");
  process.env.HARNESS_DISCOVER_EXAMPLES = "0";
  let startupCalls = 0;
  globalThis.__messageRecipientStart = () => { startupCalls += 1; return true; };

  const valid = await submit("alpha", "alpha-agent", "Local message");
  assert.equal(valid.status, 200);
  const result = await valid.json();
  assert.equal(result.ok, true);
  assert.match(result.id, /^dashboard-message-alpha:/);
  assert.equal(result.status, "pending");
  assert.equal(result.workerStarted, true);
  assert.deepEqual(readTasks(alpha.database), [{
    kind: "message",
    source: "message",
    creator: "dashboard",
    assignee: "alpha-agent",
    topic: "dashboard-message",
    body: "Local message",
    status: "pending",
  }]);
  assert.deepEqual(readTasks(beta.database), []);
  assert.equal(startupCalls, 1);

  const crossProject = await submit("alpha", "beta-agent", "Wrong project");
  assert.equal(crossProject.status, 400);
  assert.match((await crossProject.json()).error, /no longer available.*Refresh.*select/i);
  assert.equal(readTasks(alpha.database).length, 1);
  assert.deepEqual(readTasks(beta.database), []);
  assert.equal(startupCalls, 1);

  const config = JSON.parse(readFileSync(alpha.config, "utf8"));
  config.roles = [{ name: "replacement-agent", description: "Replacement agent", prompt: "Work." }];
  writeFileSync(alpha.config, `${JSON.stringify(config, null, 2)}\n`);
  const deleted = await submit("alpha", "alpha-agent", "Deleted recipient");
  assert.equal(deleted.status, 400);
  assert.match((await deleted.json()).error, /no longer available.*Refresh.*select/i);
  assert.equal(readTasks(alpha.database).length, 1);
  assert.deepEqual(readTasks(beta.database), []);
  assert.equal(startupCalls, 1);
});

function createProject(root, id, agent) {
  const directory = path.join(root, id);
  const workspace = path.join(root, `${id}-workspace`);
  const harness = path.join(workspace, ".cairn-harness");
  const config = path.join(directory, "project.json");
  const database = path.join(harness, "harness.db");
  mkdirSync(directory);
  mkdirSync(harness, { recursive: true });
  writeFileSync(config, JSON.stringify({
    name: id,
    root: workspace,
    roles: [{ name: agent, description: `${id} agent`, prompt: "Work." }],
  }));
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
  `);
  db.close();
  return { config, database };
}

function submit(projectId, agent, body) {
  return POST(new Request("http://localhost/messages", {
    method: "POST",
    body: JSON.stringify({ agent, body }),
    headers: { "content-type": "application/json" },
  }), { params: Promise.resolve({ projectId }) });
}

function readTasks(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  const rows = db.prepare("SELECT kind,source,creator,assignee,topic,body,status FROM tasks ORDER BY created_at").all();
  db.close();
  return rows.map((row) => ({ ...row }));
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
