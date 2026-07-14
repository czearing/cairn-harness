import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getProject, getProjectConfigPath } from "./projects";
import { ensureProjectRunning } from "./supervisor";
import { restartProject } from "./supervisor";

interface Role { name: string; description: string; prompt: string; }

export function sendMessage(projectId: string, agent: string, body: string) {
  const project = requiredProject(projectId);
  const db = new DatabaseSync(path.join(/*turbopackIgnore: true*/ project.root, ".cairn-harness", "harness.db"));
  db.prepare("INSERT INTO messages(id,sender,recipient,topic,body,status,created_at) VALUES(?,?,?,?,?,'pending',?)")
    .run(randomUUID(), "dashboard", agent, "dashboard-message", body, new Date().toISOString());
  db.close();
  ensureProjectRunning(projectId);
}

export function createWorkItem(projectId: string, body: string) {
  const project = requiredProject(projectId);
  const workDir = project.workDir || addWorkDirectory(projectId);
  const directory = path.join(/*turbopackIgnore: true*/ project.root, workDir, "inbox");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}.md`), `${body.trim()}\n`);
  ensureProjectRunning(projectId);
}

export function saveDraft(projectId: string, id: string, body: string) {
  const project = requiredProject(projectId);
  const file = path.join(project.root, ".cairn-harness", "drafts", `${safeId(id)}.md`);
  if (!body.trim()) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${body.trimEnd()}\n`);
}

export function deleteDraft(projectId: string, id: string) {
  const project = requiredProject(projectId);
  rmSync(path.join(project.root, ".cairn-harness", "drafts", `${safeId(id)}.md`), { force: true });
}

export function updateAgentPrompt(projectId: string, agentId: string, prompt: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { roles?: Role[] };
  const role = config.roles?.find((candidate) => candidate.name === agentId);
  if (!role) throw new Error("Agent not found");
  role.prompt = prompt;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function addAgent(projectId: string, name: string, description: string, prompt: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const id = slug(name);
  if (!id || !description.trim() || !prompt.trim()) throw new Error("Name, role, and instructions are required");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { leader?: string; roles?: Role[] };
  const roles = config.roles || [];
  if (roles.some((role) => role.name === id)) throw new Error("An agent with this name already exists");
  config.roles = [...roles, { name: id, description: description.trim(), prompt: prompt.trim() }];
  if (!config.leader) config.leader = id;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return id;
}

export function deleteAgent(projectId: string, agentId: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { leader?: string; producer?: string; roles?: Role[] };
  if (config.leader === agentId) throw new Error("Reassign leadership before deleting this agent");
  const roles = config.roles || [];
  if (!roles.some((role) => role.name === agentId)) throw new Error("Agent not found");
  config.roles = roles.filter((role) => role.name !== agentId);
  if (config.producer === agentId) delete config.producer;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  restartProject(projectId);
}

export function clearAgentContext(projectId: string, agentId: string) {
  const project = requiredProject(projectId);
  const database = path.join(project.root, ".cairn-harness", "harness.db");
  if (!existsSync(database)) throw new Error("Project database not found");
  const db = new DatabaseSync(database);
  const result = db.prepare("UPDATE agents SET session_id='',status='idle',current_topic=NULL,updated_at=? WHERE agent_id=?")
    .run(new Date().toISOString(), agentId);
  db.close();
  if (!result.changes) throw new Error("Agent not found");
  restartProject(projectId);
}

export function saveDocument(projectId: string, relative: string, body: string) {
  const project = requiredProject(projectId);
  const root = path.resolve(project.root);
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Document path is outside the project");
  writeFileSync(file, `${body.trimEnd()}\n`);
}

function addWorkDirectory(projectId: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.work_dir = "work-items";
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return "work-items";
}

export function createProject(name: string, workspace: string) {
  const id = slug(name);
  if (!id) throw new Error("Project name is required");
  if (!path.isAbsolute(workspace)) throw new Error("Workspace location must be an absolute path");
  const base = process.env.HARNESS_PROJECT_ROOT || path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "projects");
  const directory = path.join(/*turbopackIgnore: true*/ base, id);
  if (existsSync(directory)) throw new Error("A project with this name already exists");
  const root = path.resolve(workspace);
  mkdirSync(path.join(root, ".cairn-harness"), { recursive: true });
  mkdirSync(path.join(root, "todos"), { recursive: true });
  mkdirSync(path.join(root, "work-items", "inbox"), { recursive: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "project.json"), `${JSON.stringify({
    name: name.trim(), root, work_dir: "work-items", roles: [],
  }, null, 2)}\n`);
  return id;
}

function requiredProject(id: string) {
  const project = getProject(id);
  if (!project) throw new Error("Project not found");
  return project;
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function safeId(value: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(value)) throw new Error("Invalid draft id");
  return value;
}
