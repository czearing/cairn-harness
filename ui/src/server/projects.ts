import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Activity, Agent, Project, QueueItem } from "@/lib/types";
import { readConversationPage } from "./chat";
import type { ConversationPage } from "@/lib/types";

interface Config { name: string; root: string; leader: string; producer?: string; work_dir?: string; roles: { name: string; description: string; prompt: string }[]; }

export function getProjects(): Project[] {
  return configPaths().map(readProject).filter((project): project is Project => Boolean(project));
}

export function getProject(id: string) {
  return getProjects().find((project) => project.id === id);
}

export function getProjectConfigPath(id: string) {
  return configPaths().find((candidate) => path.basename(path.dirname(candidate)) === id);
}

export function getConversation(projectId: string, agentId: string, before?: string, focusId?: string, limit = 80): ConversationPage | null {
  const project = getProject(projectId);
  const agent = project?.agents.find((candidate) => candidate.id === agentId);
  if (!project || !agent) return null;
  const dbPath = path.join(project.root, ".cairn-harness", "harness.db");
  if (!existsSync(dbPath)) return { items: [], hasMore: false };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout=5000");
  const page = readConversationPage(db, project.root, agent, before, focusId, limit);
  db.close();
  return page;
}

function readProject(configPath: string): Project | null {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;
  const root = path.resolve(path.dirname(configPath), config.root);
  const id = path.basename(path.dirname(configPath));
  const base: Project = {
    id, name: config.name, root, workDir: config.work_dir,
    agents: config.roles.map((role) => roleAgent(role, config.leader, config.producer)).sort(leaderFirst), workItems: [], todos: [],
    activity: [], releases: 0, workItemCount: 0, activeWorkCount: 0,
    drafts: readDrafts(root),
  };
  const dbPath = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(dbPath)) return base;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout=5000");
  const agents = safeAll(db, "SELECT agent_id,role,status,current_topic,updated_at FROM agents ORDER BY agent_id")
    .map((row) => withLatestMessage(db, { ...dbAgent(row), prompt: config.roles.find((role) => role.name === row.agent_id)?.prompt, isLeader: row.agent_id === config.leader, isProducer: row.agent_id === config.producer }))
    .sort(leaderFirst);
  const activity = safeAll(db, "SELECT sequence,agent_id,status,output_json,completed_at FROM turns ORDER BY sequence DESC LIMIT 12").map(dbActivity);
  const storedWork = safeAll(db, "SELECT id,path,message_id,status,created_at FROM work_items ORDER BY created_at DESC LIMIT 20").map((row) => queueItem(root, row, config.leader));
  const queuedWork = readQueuedWork(root, config.work_dir || "work-items", config.leader);
  const workItems = [...queuedWork, ...storedWork];
  const todos = safeAll(db, `SELECT t.path,t.ingested_at,t.message_id,m.recipient,
    (SELECT w.path FROM work_items w WHERE w.created_at<=t.ingested_at ORDER BY w.created_at DESC LIMIT 1) parent_path
    FROM todo_files t JOIN messages m ON m.id=t.message_id
    WHERE m.status NOT IN ('completed','failed') ORDER BY t.ingested_at DESC LIMIT 20`).map((row) => todoItem(root, row));
  const releases = safeCount(db, "SELECT COUNT(*) count FROM releases");
  const workItemCount = safeCount(db, "SELECT COUNT(*) count FROM work_items") + queuedWork.length;
  const activeWorkCount = safeCount(db, "SELECT COUNT(*) count FROM work_items WHERE status NOT IN ('done','completed','released')") + queuedWork.length;
  db.close();
  return { ...base, agents, activity, workItems, todos, releases, workItemCount, activeWorkCount };
}

function configPaths() {
  const explicit = process.env.HARNESS_PROJECTS?.split(path.delimiter).filter(Boolean) || [];
  const examples = process.env.HARNESS_DISCOVER_EXAMPLES === "0" ? [] : projectConfigs(path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "examples"));
  return [...explicit, ...examples, ...projectConfigs(projectRoot())]
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
function roleAgent(role: Config["roles"][number], leader: string, producer?: string): Agent {
  return { id: role.name, role: role.description, prompt: role.prompt, isLeader: role.name === leader, isProducer: role.name === producer, status: "idle", updatedAt: "" };
}
function leaderFirst(a: Agent, b: Agent) {
  return Number(Boolean(b.isLeader)) - Number(Boolean(a.isLeader)) || a.id.localeCompare(b.id);
}
function dbAgent(row: Record<string, unknown>): Agent {
  return { id: String(row.agent_id), role: String(row.role), status: String(row.status) as Agent["status"], topic: row.current_topic ? String(row.current_topic) : undefined, updatedAt: String(row.updated_at) };
}
function withLatestMessage(db: DatabaseSync, agent: Agent): Agent {
  const message = db.prepare("SELECT body,created_at FROM messages WHERE sender=? OR recipient=? ORDER BY created_at DESC LIMIT 1").get(agent.id, agent.id) as Record<string, unknown> | undefined;
  const turn = db.prepare("SELECT output_json,completed_at FROM turns WHERE agent_id=? ORDER BY sequence DESC LIMIT 1").get(agent.id) as Record<string, unknown> | undefined;
  if (!message && !turn) return agent;
  const turnBody = turn ? dbActivity({ sequence: 0, agent_id: agent.id, status: "", output_json: turn.output_json, completed_at: turn.completed_at }).summary : "";
  const useTurn = turn && (!message || String(turn.completed_at) > String(message.created_at));
  const body = useTurn ? turnBody : String(message?.body || "");
  return { ...agent, lastMessage: body.replace(/\s+/g, " ").slice(0, 160), lastMessageAt: String(useTurn ? turn?.completed_at : message?.created_at) };
}
function dbActivity(row: Record<string, unknown>): Activity {
  const output = JSON.parse(String(row.output_json)) as { summary?: string };
  return { id: Number(row.sequence), agent: String(row.agent_id), summary: output.summary || "Completed work", status: String(row.status), completedAt: String(row.completed_at), chatId: `turn:${row.sequence}` };
}
function queueItem(root: string, row: Record<string, unknown>, leader: string): QueueItem {
  const meta = String(row.path);
  const content = readContent(root, meta);
  return { id: String(row.id), title: documentLabel(content), meta, status: String(row.status), content, agentId: leader, chatId: row.message_id ? `message:${String(row.message_id)}` : undefined };
}
function todoItem(root: string, row: Record<string, unknown>): QueueItem {
  const meta = String(row.path);
  const content = readContent(root, meta);
  const parent = row.parent_path ? documentLabel(readContent(root, String(row.parent_path))) : "";
  return { id: meta, title: documentLabel(content), meta, status: "delegated", content, context: parent ? `For ${parent}` : "Project delegation", agentId: row.recipient ? String(row.recipient) : undefined, chatId: row.message_id ? `message:${String(row.message_id)}` : undefined };
}
function documentLabel(content: string) {
  const first = content.split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !/^[a-z_-]+:\s/i.test(line));
  return first?.slice(0, 80) || "Untitled task";
}
function readDrafts(root: string): QueueItem[] {
  const directory = path.join(root, ".cairn-harness", "drafts");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const content = readContent(root, path.join(".cairn-harness", "drafts", name));
      return { id: path.basename(name, ".md"), title: documentLabel(content), meta: name, status: "draft", content };
    });
}
function readQueuedWork(root: string, workDir: string, leader: string): QueueItem[] {
  const directory = path.join(root, workDir, "inbox");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const relative = path.join(workDir, "inbox", name);
      const content = readContent(root, relative);
      return { id: `queued:${name}`, title: documentLabel(content), meta: relative, status: "queued", content, agentId: leader };
    });
}
