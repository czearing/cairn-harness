import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Activity, Agent, Project, QueueItem } from "@/lib/types";

interface Config { name: string; root: string; work_dir?: string; todo_dir?: string; roles: { name: string; description: string }[]; }

export function getProjects(): Project[] {
  return configPaths().map(readProject).filter((project): project is Project => Boolean(project));
}

export function getProject(id: string) {
  return getProjects().find((project) => project.id === id);
}

export function sendMessage(projectId: string, agent: string, body: string) {
  const project = requiredProject(projectId);
  const db = openDb(project);
  db.prepare("INSERT INTO messages(id,sender,recipient,topic,body,status,created_at) VALUES(?,?,?,?,?,'pending',?)")
    .run(randomUUID(), "dashboard", agent, "dashboard-message", body, new Date().toISOString());
  db.close();
}

export function createWorkItem(projectId: string, body: string) {
  const project = requiredProject(projectId);
  const config = readConfig(project);
  const directory = path.join(project.root, config.work_dir || "work-items", "inbox");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}.md`), `${body.trim()}\n`);
}

function readProject(configPath: string): Project | null {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;
  const root = path.resolve(path.dirname(configPath), config.root);
  const id = path.basename(path.dirname(configPath));
  const base: Project = { id, name: config.name, root, agents: config.roles.map(roleAgent), workItems: [], todos: [], activity: [], releases: 0 };
  const dbPath = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(dbPath)) return base;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const agents = safeAll(db, "SELECT agent_id,role,status,current_topic,updated_at FROM agents ORDER BY agent_id");
  const activity = safeAll(db, "SELECT sequence,agent_id,status,output_json,completed_at FROM turns ORDER BY sequence DESC LIMIT 12");
  const workItems = safeAll(db, "SELECT id,path,status,created_at FROM work_items ORDER BY created_at DESC LIMIT 20");
  const todos = safeAll(db, "SELECT path,ingested_at FROM todo_files ORDER BY ingested_at DESC LIMIT 20");
  const releases = safeCount(db, "SELECT COUNT(*) count FROM releases");
  db.close();
  return { ...base, agents: agents.map(dbAgent), activity: activity.map(dbActivity), workItems: workItems.map(workItem), todos: todos.map(todoItem), releases };
}

function safeAll(db: DatabaseSync, sql: string) {
  try { return db.prepare(sql).all() as Record<string, unknown>[]; }
  catch { return []; }
}

function safeCount(db: DatabaseSync, sql: string) {
  try { return Number((db.prepare(sql).get() as { count: number }).count); }
  catch { return 0; }
}

function configPaths() {
  const explicit = process.env.HARNESS_PROJECTS?.split(path.delimiter).filter(Boolean);
  if (explicit?.length) return explicit;
  const examples = path.resolve(process.cwd(), "..", "examples");
  if (!existsSync(examples)) return [];
  return readdirSync(examples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(examples, entry.name, "project.json"))
    .filter(existsSync);
}

function requiredProject(id: string) {
  const project = getProject(id);
  if (!project) throw new Error("Project not found");
  return project;
}

function readConfig(project: Project) {
  const config = configPaths().find((candidate) => path.basename(path.dirname(candidate)) === project.id);
  if (!config) throw new Error("Project config not found");
  return JSON.parse(readFileSync(config, "utf8")) as Config;
}

function openDb(project: Project) {
  return new DatabaseSync(path.join(project.root, ".cairn-harness", "harness.db"));
}

function roleAgent(role: Config["roles"][number]): Agent {
  return { id: role.name, role: role.description, status: "idle", updatedAt: "" };
}
function dbAgent(row: Record<string, unknown>): Agent {
  return { id: String(row.agent_id), role: String(row.role), status: String(row.status) as Agent["status"], topic: row.current_topic ? String(row.current_topic) : undefined, updatedAt: String(row.updated_at) };
}
function dbActivity(row: Record<string, unknown>): Activity {
  const output = JSON.parse(String(row.output_json)) as { summary?: string };
  return { id: Number(row.sequence), agent: String(row.agent_id), summary: output.summary || "Completed work", status: String(row.status), completedAt: String(row.completed_at) };
}
function workItem(row: Record<string, unknown>): QueueItem {
  return { id: String(row.id), title: path.basename(String(row.path)), meta: String(row.path), status: String(row.status) };
}
function todoItem(row: Record<string, unknown>): QueueItem {
  return { id: String(row.path), title: path.basename(String(row.path)), meta: String(row.path), status: "delegated" };
}
