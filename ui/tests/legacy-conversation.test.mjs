import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync as NativeDatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sqliteShim = "test:conversation-sqlite";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node:sqlite") return { url: sqliteShim, shortCircuit: true };
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
    if (url === sqliteShim) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export class DatabaseSync {
          constructor(file, options) {
            return globalThis.__legacyConversationDatabaseFactory(file, options);
          }
        }`,
      };
    }
    return nextLoad(url, context);
  },
});

const { GET } = await import("../src/app/api/projects/[projectId]/messages/route.ts");

test("legacy conversation reads stay read-only and always close the database", async (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-legacy-conversation-"));
  const previousProjectRoot = process.env.HARNESS_PROJECT_ROOT;
  const previousProjects = process.env.HARNESS_PROJECTS;
  const previousExamples = process.env.HARNESS_DISCOVER_EXAMPLES;
  context.after(() => {
    delete globalThis.__legacyConversationDatabaseFactory;
    rmSync(fixtureRoot, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECT_ROOT", previousProjectRoot);
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    restoreEnvironment("HARNESS_DISCOVER_EXAMPLES", previousExamples);
  });

  const managedRoot = path.join(fixtureRoot, "managed-projects");
  const projectDirectory = path.join(fixtureRoot, "legacy-project");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  const databasePath = path.join(harnessDirectory, "harness.db");
  mkdirSync(managedRoot, { recursive: true });
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    name: "Legacy conversation",
    root: workspace,
    leader: "lead",
    roles: [{ name: "lead", description: "Project lead", prompt: "Lead." }],
  }));
  const fixture = new NativeDatabaseSync(databasePath);
  fixture.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
    INSERT INTO agents VALUES('lead','Project lead','lead-session','idle',NULL,'2026-07-15T12:00:00Z');
    INSERT INTO tasks VALUES('old-message',NULL,NULL,'message','message','dashboard','lead','request','Legacy history',NULL,'completed',0,NULL,'2026-07-15T10:00:00Z',NULL,'2026-07-15T10:00:01Z');
    INSERT INTO tasks VALUES('new-message',NULL,NULL,'message','message','dashboard','lead','request','Current history',NULL,'completed',0,NULL,'2026-07-15T12:00:00Z',NULL,'2026-07-15T12:00:01Z');
  `);
  fixture.close();
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  delete process.env.HARNESS_DISCOVER_EXAMPLES;

  const openings = [];
  let injectedConversationError;
  globalThis.__legacyConversationDatabaseFactory = (file, options) => {
    const database = new NativeDatabaseSync(file, options);
    const record = { closed: 0, statements: [] };
    openings.push(record);
    return {
      exec(sql) {
        record.statements.push(sql);
        return database.exec(sql);
      },
      prepare(sql) {
        if (injectedConversationError && sql.includes("SELECT id,creator,assignee,body,status,error,created_at FROM tasks")) {
          throw injectedConversationError;
        }
        return database.prepare(sql);
      },
      close() {
        record.closed += 1;
        database.close();
      },
    };
  };
  const requestConversation = () => GET(
    new Request("http://localhost/api/projects/legacy-project/messages?agent=lead"),
    { params: Promise.resolve({ projectId: "legacy-project" }) },
  );

  const legacyResponse = await requestConversation();
  const legacyPage = await legacyResponse.json();
  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(legacyPage.items.map((item) => item.body), ["Legacy history", "Current history"]);
  assert.ok(openings.every((record) => record.closed === 1));
  assert.ok(openings.every((record) => record.statements.every((sql) => !/CREATE TABLE/i.test(sql))));

  const resetDatabase = new NativeDatabaseSync(databasePath);
  resetDatabase.exec(`
    CREATE TABLE context_resets(agent_id TEXT PRIMARY KEY,cleared_at TEXT NOT NULL);
    INSERT INTO context_resets VALUES('lead','2026-07-15T11:00:00Z');
  `);
  resetDatabase.close();
  openings.length = 0;
  const resetResponse = await requestConversation();
  const resetPage = await resetResponse.json();
  assert.deepEqual(resetPage.items.map((item) => item.body), ["Legacy history", "Current history"]);
  assert.ok(openings.every((record) => record.closed === 1));
  assert.ok(openings.every((record) => record.statements.every((sql) => !/CREATE TABLE/i.test(sql))));

  openings.length = 0;
  injectedConversationError = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
  await assert.rejects(requestConversation, /database is locked/);
  assert.ok(openings.every((record) => record.closed === 1));
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
