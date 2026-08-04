import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

const { getHealth } = await import("../src/server/health.ts");
const { GET: getProjectsResponse } = await import("../src/app/api/projects/route.ts");
const { readProcessIdentity } = await import("../src/server/worker-process-identity.ts");

test("health reports a malformed registration while project listing remains resilient", async (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-health-registration-"));
  const previousProjectRoot = process.env.HARNESS_PROJECT_ROOT;
  const previousProjects = process.env.HARNESS_PROJECTS;
  const previousExamples = process.env.HARNESS_DISCOVER_EXAMPLES;
  const previousConsoleError = console.error;
  context.after(() => {
    console.error = previousConsoleError;
    rmSync(fixtureRoot, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECT_ROOT", previousProjectRoot);
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    restoreEnvironment("HARNESS_DISCOVER_EXAMPLES", previousExamples);
  });

  const managedRoot = path.join(fixtureRoot, "managed-projects");
  const validDirectory = path.join(fixtureRoot, "valid");
  const validWorkspace = path.join(fixtureRoot, "valid-workspace");
  const malformedDirectory = path.join(fixtureRoot, "malformed");
  const validConfigPath = path.join(validDirectory, "project.json");
  const malformedConfigPath = path.join(malformedDirectory, "project.json");
  mkdirSync(managedRoot, { recursive: true });
  mkdirSync(validDirectory);
  mkdirSync(validWorkspace);
  mkdirSync(malformedDirectory);
  writeFileSync(validConfigPath, JSON.stringify({ name: "Valid project", root: validWorkspace, roles: [] }));
  writeFileSync(malformedConfigPath, "{ malformed");
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = [validConfigPath, malformedConfigPath, malformedConfigPath].join(path.delimiter);
  process.env.HARNESS_DISCOVER_EXAMPLES = "0";
  console.error = () => {};

  const response = await getProjectsResponse();
  const projects = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(projects.map(({ id, name }) => ({ id, name })), [{ id: "valid", name: "Valid project" }]);

  const health = getHealth();
  assert.equal(health.status, "attention");
  assert.equal(health.label, "1 issue");
  assert.equal(health.issues.length, 1);
  assert.equal(health.issues[0].summary, "Project registration is invalid");
  assert.ok(health.issues[0].transcript.includes(malformedConfigPath));
  assert.match(health.issues[0].transcript, /SyntaxError:|JSON/i);
});

test("health excludes retryable failed agents while preserving terminal failures", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-health-retryable-"));
  const previousProjectRoot = process.env.HARNESS_PROJECT_ROOT;
  const previousProjects = process.env.HARNESS_PROJECTS;
  const previousExamples = process.env.HARNESS_DISCOVER_EXAMPLES;
  context.after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECT_ROOT", previousProjectRoot);
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    restoreEnvironment("HARNESS_DISCOVER_EXAMPLES", previousExamples);
  });

  const managedRoot = path.join(fixtureRoot, "managed-projects");
  const projectDirectory = path.join(fixtureRoot, "retryable-project");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  mkdirSync(managedRoot, { recursive: true });
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    name: "Retryable health project",
    root: workspace,
    roles: [
      { name: "retryable", description: "Retryable agent", prompt: "Retry." },
      { name: "terminal", description: "Terminal agent", prompt: "Stop." },
    ],
  }));
  const identity = readProcessIdentity(process.pid);
  assert.ok(identity);
  writeFileSync(path.join(harnessDirectory, "ui-worker.json"), JSON.stringify({
    pid: process.pid,
    config: configPath,
    startedAt: "2026-07-16T16:00:00.000Z",
    log: path.join(harnessDirectory, "worker.log"),
    process: identity,
  }));
  const databasePath = path.join(harnessDirectory, "harness.db");
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,message_id TEXT NOT NULL,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
    INSERT INTO agents VALUES('retryable','Retryable agent','retry-session','failed',NULL,'2026-07-16T16:00:00Z');
    INSERT INTO agents VALUES('terminal','Terminal agent','terminal-session','failed',NULL,'2026-07-16T16:00:00Z');
    INSERT INTO tasks VALUES('retry-root',NULL,NULL,'root','user','operator','retryable','retry','Retry startup',NULL,'pending',0,NULL,'2026-07-16T15:59:00Z',NULL,NULL);
    INSERT INTO tasks VALUES('terminal-root',NULL,NULL,'root','user','operator','terminal','terminal','Terminal work',NULL,'failed',1,'terminal failure','2026-07-16T15:58:00Z',NULL,'2026-07-16T16:01:00Z');
    INSERT INTO tasks VALUES('later-success',NULL,NULL,'root','user','operator','retryable','success','Later success','done','completed',1,NULL,'2026-07-16T16:02:00Z','2026-07-16T16:02:01Z','2026-07-16T16:02:02Z');
    INSERT INTO turns VALUES(1,'later-success','retryable','completed','{"summary":"later success"}','2026-07-16T16:02:02Z');
  `);
  db.close();
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  process.env.HARNESS_DISCOVER_EXAMPLES = "0";

  const attention = getHealth();
  assert.equal(attention.status, "attention");
  assert.equal(attention.issues[0].summary, "1 failed agent");
  assert.match(attention.issues[0].transcript, /terminal: terminal failure/);
  assert.doesNotMatch(attention.issues[0].transcript, /retryable/i);
  assert.equal(attention.issues[1].summary, "1 recorded failure");
  assert.match(attention.issues[1].transcript, /terminal failure/);

  const mutable = new DatabaseSync(databasePath);
  mutable.exec("DELETE FROM agents WHERE agent_id='terminal'");
  mutable.exec("DELETE FROM tasks WHERE assignee='terminal'");
  mutable.close();
  assert.deepEqual(getHealth(), { status: "healthy", label: "All systems operational", issues: [] });
});

test("health reports required database query failures without fabricating counts", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-health-db-"));
  const previousProjectRoot = process.env.HARNESS_PROJECT_ROOT;
  const previousProjects = process.env.HARNESS_PROJECTS;
  const previousExamples = process.env.HARNESS_DISCOVER_EXAMPLES;
  context.after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECT_ROOT", previousProjectRoot);
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    restoreEnvironment("HARNESS_DISCOVER_EXAMPLES", previousExamples);
  });

  const managedRoot = path.join(fixtureRoot, "managed-projects");
  const projectDirectory = path.join(fixtureRoot, "health-project");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  const databasePath = path.join(harnessDirectory, "harness.db");
  const movedDatabasePath = `${databasePath}.moved`;
  mkdirSync(managedRoot, { recursive: true });
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    name: "Health query project",
    root: workspace,
    roles: [{ name: "lead", description: "Project lead", prompt: "Lead." }],
  }));
  const identity = readProcessIdentity(process.pid);
  assert.ok(identity);
  writeFileSync(path.join(harnessDirectory, "ui-worker.json"), JSON.stringify({
    pid: process.pid,
    config: configPath,
    startedAt: "2026-07-15T16:00:00.000Z",
    log: path.join(harnessDirectory, "worker.log"),
    process: identity,
  }));
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,message_id TEXT NOT NULL,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
    INSERT INTO agents VALUES('lead','Project lead','lead-session','idle',NULL,'2026-07-15T16:00:00Z');
  `);
  db.close();
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  process.env.HARNESS_DISCOVER_EXAMPLES = "0";

  const failed = getHealth();
  assert.equal(failed.status, "attention");
  assert.equal(failed.issues.length, 1);
  assert.deepEqual({
    projectId: failed.issues[0].projectId,
    projectName: failed.issues[0].projectName,
    summary: failed.issues[0].summary,
  }, {
    projectId: "health-project",
    projectName: "Health query project",
    summary: "Project database diagnostics are unavailable",
  });
  assert.ok(failed.issues[0].transcript.includes(path.join(realpathSync.native(workspace), ".cairn-harness", "harness.db")));
  assert.match(failed.issues[0].transcript, /no such column: error/i);
  assert.doesNotMatch(failed.issues[0].summary, /failed agent|recorded failure|suspicious waiting/i);
  renameSync(databasePath, movedDatabasePath);
  renameSync(movedDatabasePath, databasePath);

  const valid = new DatabaseSync(databasePath);
  valid.exec("ALTER TABLE tasks ADD COLUMN error TEXT");
  valid.close();
  const healthy = getHealth();
  assert.deepEqual(healthy, { status: "healthy", label: "All systems operational", issues: [] });
  renameSync(databasePath, movedDatabasePath);
  renameSync(movedDatabasePath, databasePath);
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
