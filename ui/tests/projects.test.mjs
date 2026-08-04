import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

const { getProjects } = await import("../src/server/projects.ts");
const { GET: getProjectsResponse, projectsResponse } = await import("../src/app/api/projects/route.ts");

test("project listing skips a malformed registration and reports its path once", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-projects-"));
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
  process.env.HARNESS_PROJECTS = [validConfigPath, malformedConfigPath].join(path.delimiter);
  delete process.env.HARNESS_DISCOVER_EXAMPLES;

  const diagnostics = [];
  console.error = (...arguments_) => diagnostics.push(arguments_);

  const projects = getProjects();

  assert.deepEqual(projects.map(({ id, name, root }) => ({ id, name, root })), [
    { id: "valid", name: "Valid project", root: realpathSync.native(validWorkspace) },
  ]);
  assert.equal(diagnostics.length, 1);
  assert.match(String(diagnostics[0][0]), /Skipping invalid project registration/);
  assert.ok(String(diagnostics[0][0]).includes(malformedConfigPath));
});

test("project API preserves core data when draft enumeration fails", async (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-drafts-"));
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
  const projectDirectory = path.join(fixtureRoot, "draft-failure");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const draftsPath = path.join(harnessDirectory, "drafts");
  const configPath = path.join(projectDirectory, "project.json");
  mkdirSync(managedRoot, { recursive: true });
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(draftsPath, "not a directory");
  writeFileSync(configPath, JSON.stringify({
    name: "Draft failure project",
    root: workspace,
    leader: "lead",
    roles: [{ name: "lead", description: "Project lead", prompt: "Lead the project." }],
  }));
  const db = new DatabaseSync(path.join(harnessDirectory, "harness.db"));
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
    INSERT INTO agents VALUES('lead','Project lead','lead-session','idle','Review queue','2026-07-15T12:00:00Z');
    INSERT INTO tasks VALUES('active-root',NULL,NULL,'root','manual','dashboard','lead','work-item','Active task',NULL,'pending',0,NULL,'2026-07-15T12:00:00Z',NULL,NULL);
    INSERT INTO tasks VALUES('done-root',NULL,NULL,'root','manual','dashboard','lead','work-item','Completed task',NULL,'completed',0,NULL,'2026-07-15T11:00:00Z',NULL,'2026-07-15T11:30:00Z');
  `);
  db.close();
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  delete process.env.HARNESS_DISCOVER_EXAMPLES;
  const diagnostics = [];
  console.error = (...arguments_) => diagnostics.push(arguments_);

  const response = await getProjectsResponse();
  const projects = await response.json();

  assert.equal(response.status, 200);
  assert.equal(projects.length, 1);
  assert.deepEqual({
    id: projects[0].id,
    agents: projects[0].agents.map((agent) => agent.id),
    workItemCount: projects[0].workItemCount,
    activeWorkCount: projects[0].activeWorkCount,
    drafts: projects[0].drafts,
  }, {
    id: "draft-failure",
    agents: ["lead"],
    workItemCount: 2,
    activeWorkCount: 1,
    drafts: [],
  });
  assert.equal(diagnostics.length, 1);
  assert.match(String(diagnostics[0][0]), /Could not enumerate drafts/);
  assert.ok(String(diagnostics[0][0]).includes("draft-failure"));
  assert.ok(String(diagnostics[0][0]).includes(path.join(realpathSync.native(workspace), ".cairn-harness", "drafts")));
});

test("project API contains malformed turn output to its activity row", async (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-turns-"));
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
  const projectDirectory = path.join(fixtureRoot, "malformed-turn");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  mkdirSync(managedRoot, { recursive: true });
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    name: "Malformed turn project",
    root: workspace,
    leader: "lead",
    roles: [{ name: "lead", description: "Project lead", prompt: "Lead the project." }],
  }));
  const db = new DatabaseSync(path.join(harnessDirectory, "harness.db"));
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT,inbound_topic TEXT,inbound_body TEXT);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
    INSERT INTO agents VALUES('lead','Project lead','lead-session','idle','Review results','2026-07-15T12:00:00Z');
    INSERT INTO tasks VALUES('root-task',NULL,NULL,'root','manual','dashboard','lead','work-item','Keep project data visible',NULL,'pending',0,NULL,'2026-07-15T11:00:00Z',NULL,NULL);
    INSERT INTO turns VALUES(1,'lead','completed','{"summary":"Valid turn summary"}','2026-07-15T11:30:00Z',NULL,NULL);
    INSERT INTO turns VALUES(2,'lead','failed','{ malformed','2026-07-15T12:30:00Z',NULL,NULL);
    INSERT INTO turns VALUES(0,'lead','completed','{"summary":"Completed deliverable."}','2026-07-15T10:30:00Z','work-item','Review pull request #42: Improve dashboard freshness');
  `);
  db.close();
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  delete process.env.HARNESS_DISCOVER_EXAMPLES;
  const diagnostics = [];
  console.error = (...arguments_) => diagnostics.push(arguments_);

  const response = await getProjectsResponse();
  const projects = await response.json();

  assert.equal(response.status, 200);
  assert.equal(projects.length, 1);
  const [project] = projects;
  assert.equal(project.id, "malformed-turn");
  assert.deepEqual(project.agents.map((agent) => agent.id), ["lead"]);
  assert.equal(project.workItemCount, 1);
  assert.equal(project.activeWorkCount, 1);
  assert.deepEqual(project.workItems.map((item) => item.id), ["root-task"]);
  assert.equal(project.activity.length, 3);
  const valid = project.activity.find((activity) => activity.id === 1);
  const malformed = project.activity.find((activity) => activity.id === 2);
  const contextual = project.activity.find((activity) => activity.id === 0);
  assert.equal(valid.summary, "Valid turn summary");
  assert.equal(contextual.summary, "Completed: Review pull request #42: Improve dashboard freshness");
  assert.deepEqual({
    id: malformed.id,
    agent: malformed.agent,
    status: malformed.status,
    completedAt: malformed.completedAt,
    chatId: malformed.chatId,
  }, {
    id: 2,
    agent: "lead",
    status: "failed",
    completedAt: "2026-07-15T12:30:00Z",
    chatId: "turn:2",
  });
  assert.match(malformed.summary, /malformed|invalid/i);
  assert.match(project.agents[0].lastMessage, /malformed|invalid/i);
  assert.equal(project.agents[0].lastMessageAt, "2026-07-15T12:30:00Z");
  assert.equal(diagnostics.length, 1);
  assert.match(String(diagnostics[0][0]), /project "malformed-turn".*sequence 2.*agent "lead"/);
});

test("latest agent messages use two project-wide queries regardless of agent count", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-latest-"));
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
  const projectDirectory = path.join(fixtureRoot, "latest-messages");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  mkdirSync(managedRoot);
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(path.join(harnessDirectory, "harness.db"), "");
  const roles = Array.from({ length: 50 }, (_, index) => ({
    name: `agent-${String(index).padStart(2, "0")}`,
    title: index === 0 ? "Configured Zero" : undefined,
    description: `Configured role ${index}`,
    prompt: `Prompt ${index}`,
  }));
  writeFileSync(configPath, JSON.stringify({
    name: "Latest message project",
    root: workspace,
    leader: "agent-49",
    roles,
  }));
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  delete process.env.HARNESS_DISCOVER_EXAMPLES;
  console.error = () => {};

  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
    INSERT INTO agents VALUES('agent-00','Runtime role','session-00','claimed','Runtime topic','2026-07-15T09:00:00Z');
  `);
  const insertTask = db.prepare("INSERT INTO tasks VALUES(?,NULL,NULL,'root','user',?,?,?, ?,NULL,'pending',0,NULL,?,NULL,NULL)");
  const taskOnlyBody = `Task   only\n${"x".repeat(170)}`;
  insertTask.run("task-00", "operator", "agent-00", "task-only", taskOnlyBody, "2026-07-15T10:00:00Z");
  insertTask.run("task-02", "operator", "agent-02", "both-turn", "Older task", "2026-07-15T10:00:00Z");
  insertTask.run("task-03", "operator", "agent-03", "both-task", "Newer task", "2026-07-15T13:00:00Z");
  insertTask.run("task-06", "operator", "agent-06", "equal", "Equal timestamp task", "2026-07-15T15:00:00Z");
  const insertTurn = db.prepare("INSERT INTO turns VALUES(?,?,?,?,?)");
  insertTurn.run(1, "agent-01", "completed", '{"summary":"Turn only summary"}', "2026-07-15T11:00:00Z");
  insertTurn.run(2, "agent-02", "completed", '{"summary":"Newer turn"}', "2026-07-15T12:00:00Z");
  insertTurn.run(3, "agent-03", "completed", '{"summary":"Older turn"}', "2026-07-15T12:00:00Z");
  insertTurn.run(4, "agent-05", "failed", "{ malformed", "2026-07-15T14:00:00Z");
  insertTurn.run(5, "agent-06", "completed", '{"summary":"Equal timestamp turn"}', "2026-07-15T15:00:00Z");

  const preparedSql = [];
  const projects = getProjects(() => ({
    prepare(sql) {
      preparedSql.push(sql);
      return db.prepare(sql);
    },
    close() {
      db.close();
    },
  }));

  assert.equal(projects.length, 1);
  const agents = projects[0].agents;
  assert.equal(agents.length, 50);
  assert.equal(agents[0].id, "agent-49");
  assert.deepEqual(pickAgent(agents, "agent-00"), {
    id: "agent-00",
    title: "Configured Zero",
    role: "Configured role 0",
    prompt: "Prompt 0",
    status: "claimed",
    topic: "Runtime topic",
    lastMessage: taskOnlyBody.replace(/\s+/g, " ").slice(0, 160),
    lastMessageAt: "2026-07-15T10:00:00Z",
  });
  assert.deepEqual(latestMessage(agents, "agent-01"), ["Turn only summary", "2026-07-15T11:00:00Z"]);
  assert.deepEqual(latestMessage(agents, "agent-02"), ["Newer turn", "2026-07-15T12:00:00Z"]);
  assert.deepEqual(latestMessage(agents, "agent-03"), ["Newer task", "2026-07-15T13:00:00Z"]);
  assert.deepEqual(latestMessage(agents, "agent-04"), [undefined, undefined]);
  assert.deepEqual(latestMessage(agents, "agent-05"), ["Malformed turn output", "2026-07-15T14:00:00Z"]);
  assert.deepEqual(latestMessage(agents, "agent-06"), ["Equal timestamp task", "2026-07-15T15:00:00Z"]);
  assert.deepEqual({
    id: agents.find((agent) => agent.id === "agent-48").id,
    status: agents.find((agent) => agent.id === "agent-48").status,
    prompt: agents.find((agent) => agent.id === "agent-48").prompt,
  }, { id: "agent-48", status: "idle", prompt: "Prompt 48" });

  const latestQueries = preparedSql.filter((sql) => sql.includes("latest-agent-"));
  assert.equal(latestQueries.length, 2);
  assert.equal(latestQueries.filter((sql) => sql.includes("latest-agent-task")).length, 1);
  assert.equal(latestQueries.filter((sql) => sql.includes("latest-agent-turn")).length, 1);
  assert.equal(preparedSql.filter((sql) => sql.includes("WHERE creator=? OR assignee=?")).length, 0);
});

test("project projection retains all active roots and only the 20 newest terminal roots", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-task-cap-"));
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
  const projectDirectory = path.join(fixtureRoot, "task-cap");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  mkdirSync(managedRoot);
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(path.join(projectDirectory, ".cairn-paused"), "");
  writeFileSync(configPath, JSON.stringify({
    name: "Task cap project",
    root: workspace,
    roles: [{ name: "lead", description: "Project lead", prompt: "Lead." }],
  }));
  const db = new DatabaseSync(path.join(harnessDirectory, "harness.db"));
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
  `);
  const insert = db.prepare(`INSERT INTO tasks
    (id,parent_id,kind,source,creator,assignee,topic,body,status,attempts,created_at)
    VALUES (?,NULL,'root','manual','dashboard','lead','work-item',?,?,0,?)`);
  insert.run("old-pending", "Old pending", "pending", "2026-07-14T12:00:00Z");
  for (let index = 1; index <= 25; index++) {
    const suffix = String(index).padStart(2, "0");
    insert.run(`terminal-${suffix}`, `Terminal ${suffix}`, "completed", `2026-07-15T12:${suffix}:00Z`);
  }
  insert.run("buffered-root", "Buffered root", "backlog", "2026-07-15T12:15:30Z");
  db.close();
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  delete process.env.HARNESS_DISCOVER_EXAMPLES;

  const [project] = getProjects();
  const expectedIds = Array.from({ length: 20 }, (_, index) => `terminal-${String(25 - index).padStart(2, "0")}`);
  expectedIds.splice(10, 0, "buffered-root");
  expectedIds.push("old-pending");

  assert.deepEqual(project.workItems.map((item) => item.id), expectedIds);
  assert.equal(new Set(project.workItems.map((item) => item.id)).size, 22);
  assert.deepEqual(project.workItems.filter((item) => item.id.includes("terminal")).map((item) => item.id),
    Array.from({ length: 20 }, (_, index) => `terminal-${String(25 - index).padStart(2, "0")}`));
  assert.deepEqual(project.workItems.filter((item) => item.id === "old-pending" || item.id === "buffered-root")
    .map((item) => [item.id, item.status]), [["buffered-root", "paused"], ["old-pending", "paused"]]);
  assert.equal(project.workItems.some((item) => /^terminal-0[1-5]$/.test(item.id)), false);
  assert.equal(project.workItemCount, 27);
  assert.equal(project.activeWorkCount, 1);
  assert.equal(project.backlogTaskCount, 1);

  const reducedDb = new DatabaseSync(path.join(harnessDirectory, "harness.db"));
  reducedDb.exec("DELETE FROM tasks WHERE id LIKE 'terminal-%' AND id NOT IN ('terminal-20','terminal-25')");
  reducedDb.close();
  assert.deepEqual(getProjects()[0].workItems.map((item) => item.id),
    ["terminal-25", "terminal-20", "buffered-root", "old-pending"]);
});

test("project request propagates required database failures and closes each database exactly once", async (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-close-"));
  const previousProjectRoot = process.env.HARNESS_PROJECT_ROOT;
  const previousProjects = process.env.HARNESS_PROJECTS;
  const previousExamples = process.env.HARNESS_DISCOVER_EXAMPLES;
  context.after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECT_ROOT", previousProjectRoot);
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    restoreEnvironment("HARNESS_DISCOVER_EXAMPLES", previousExamples);
  });

  const projectDirectory = path.join(fixtureRoot, "close-test");
  const managedRoot = path.join(fixtureRoot, "managed-projects");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  mkdirSync(projectDirectory);
  mkdirSync(managedRoot);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(path.join(harnessDirectory, "harness.db"), "");
  writeFileSync(configPath, JSON.stringify({
    name: "Close test",
    root: workspace,
    leader: "lead",
    roles: [{ name: "lead", description: "Project lead", prompt: "Lead." }],
  }));
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  delete process.env.HARNESS_DISCOVER_EXAMPLES;
  const databases = [];
  const outcomes = ["succeed", "locked"];
  const openDatabase = () => {
    const outcome = outcomes.shift();
    const database = fakeProjectDatabase(outcome === "locked");
    databases.push(database);
    return database;
  };

  const successful = projectsResponse(() => getProjects(openDatabase));
  assert.equal(successful.status, 200);
  const projects = await successful.json();
  assert.deepEqual(projects.map((project) => ({
    id: project.id,
    agents: project.agents.map((agent) => agent.id),
    workItemCount: project.workItemCount,
    activity: project.activity,
  })), [{ id: "close-test", agents: ["lead"], workItemCount: 0, activity: [] }]);
  assert.throws(
    () => projectsResponse(() => getProjects(openDatabase)),
    /database is locked/,
  );
  assert.deepEqual(databases.map((database) => database.closes), [1, 1]);
});

function fakeProjectDatabase(lockWorkItems) {
  return {
    closes: 0,
    close() { this.closes += 1; },
    prepare(sql) {
      return {
        all() {
          if (sql.includes("FROM agents")) return [{
            agent_id: "lead", role: "Project lead", status: "idle", current_topic: null, updated_at: "now",
          }];
          if (sql.includes("WHERE kind='root' AND status NOT IN") && lockWorkItems) {
            throw new Error("database is locked");
          }
          return [];
        },
        get() {
          if (sql.includes("COUNT(*)")) return { count: 0 };
          return undefined;
        },
      };
    },
  };
}

function latestMessage(agents, id) {
  const agent = agents.find((candidate) => candidate.id === id);
  return [agent.lastMessage, agent.lastMessageAt];
}

function pickAgent(agents, id) {
  const agent = agents.find((candidate) => candidate.id === id);
  return {
    id: agent.id,
    title: agent.title,
    role: agent.role,
    prompt: agent.prompt,
    status: agent.status,
    topic: agent.topic,
    lastMessage: agent.lastMessage,
    lastMessageAt: agent.lastMessageAt,
  };
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
