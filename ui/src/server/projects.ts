import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Activity, Agent, Project, QueueItem } from "@/lib/types";
import { readConversations } from "./chat";

interface Config { name: string; root: string; work_dir?: string; roles: { name: string; description: string }[]; }

export function getProjects(): Project[] {
  return configPaths().map(readProject).filter((project): project is Project => Boolean(project));
}

export function getProject(id: string) {
  return getProjects().find((project) => project.id === id);
}

export function getProjectConfigPath(id: string) {
  return configPaths().find((candidate) => path.basename(path.dirname(candidate)) === id);
}

function readProject(configPath: string): Project | null {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;
  const root = path.resolve(path.dirname(configPath), config.root);
  const id = path.basename(path.dirname(configPath));
  const base: Project = {
    id, name: config.name, root, workDir: config.work_dir,
    agents: config.roles.map(roleAgent), workItems: [], todos: [],
    activity: [], conversations: {}, releases: 0,
  };
  const dbPath = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(dbPath)) return base;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const agents = safeAll(db, "SELECT agent_id,role,status,current_topic,updated_at FROM agents ORDER BY agent_id").map(dbAgent);
  const activity = safeAll(db, "SELECT sequence,agent_id,status,output_json,completed_at FROM turns ORDER BY sequence DESC LIMIT 12").map(dbActivity);
  const workItems = safeAll(db, "SELECT id,path,status,created_at FROM work_items ORDER BY created_at DESC LIMIT 20").map((row) => queueItem(root, row));
  const todos = safeAll(db, "SELECT path,ingested_at FROM todo_files ORDER BY ingested_at DESC LIMIT 20").map((row) => todoItem(root, row));
  const releases = safeCount(db, "SELECT COUNT(*) count FROM releases");
  const conversations = readConversations(db, agents);
  db.close();
  return { ...base, agents, activity, workItems, todos, conversations, releases };
}

function configPaths() {
  const explicit = process.env.HARNESS_PROJECTS?.split(path.delimiter).filter(Boolean) || [];
  return [...explicit, ...projectConfigs(path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "examples")), ...projectConfigs(projectRoot())]
    .filter((value, index, values) => values.indexOf(value) === index);
}

function projectRoot() {
  return process.env.HARNESS_PROJECT_ROOT || path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "projects");
}

function projectConfigs(directory: string) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name, "project.json"))
    .filter(existsSync);
}

function safeAll(db: DatabaseSync, sql: string) {
  try { return db.prepare(sql).all() as Record<string, unknown>[]; }
  catch { return []; }
}
function safeCount(db: DatabaseSync, sql: string) {
  try { return Number((db.prepare(sql).get() as { count: number }).count); }
  catch { return 0; }
}
function readContent(root: string, relative: string) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root)) || !existsSync(file)) return "";
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}
function roleAgent(role: Config["roles"][number]): Agent {
  return { id: role.name, role: role.description, status: "idle", updatedAt: "" };
}
function dbAgent(row: Record<string, unknown>): Agent {
  return { id: String(row.agent_id), role: String(row.role), status: String(row.status) as Agent["status"], topic: row.current_topic ? String(row.current_topic) : undefined, updatedAt: String(row.updated_at) };
}
function dbActivity(row: Record<string, unknown>): Activity {
  const output = JSON.parse(String(row.output_json)) as { summary?: string };
  return { id: Number(row.sequence), agent: String(row.agent_id), summary: output.summary || "Completed work", status: String(row.status), completedAt: String(row.completed_at), chatId: `turn:${row.sequence}` };
}
function queueItem(root: string, row: Record<string, unknown>): QueueItem {
  const meta = String(row.path);
  return { id: String(row.id), title: path.basename(meta), meta, status: String(row.status), content: readContent(root, meta) };
}
function todoItem(root: string, row: Record<string, unknown>): QueueItem {
  const meta = String(row.path);
  return { id: meta, title: path.basename(meta), meta, status: "delegated", content: readContent(root, meta) };
}
