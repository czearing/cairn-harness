import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import { manualLeaderWorkItemRoot } from "./root-task-admission";
import type { Activity, Agent, IdeaAgent, Project, QueueItem } from "@/lib/types";
import { readConversationPage } from "./chat";
import type { ConversationPage } from "@/lib/types";
import { readDelegatedActions, rootTaskItem } from "./task-projections";
import { readSupersededReviewTaskIds } from "./review-task-status";
import { canonicalWorkspaceRoot, getProjectConfigPath, getProjectConfigPaths } from "./project-registry";
import { writeProjectConfig } from "./project-config-write";
import { parseTurnOutput } from "./turn-output";
import { migrateAgentRelationships, migrateLegacyProjectModel, type ModelProjectConfig } from "./model-config";
import { projectAgentStatus, readRecoverableRootWork, recoverableRootWorkFor, type RecoverableRootWork } from "./agent-status-projection";
import { cachedProject, forgetProjects, projectInputFingerprint, storeProject } from "./projects-snapshot";

export { getProjectConfigPath } from "./project-registry";

interface Config {
  name: string; root: string; leader?: string; leader_task_limit?: number; max_active_tasks?: number;
  configuration_revision?: number;
  idea_agents?: { agent: string; task_limit: number; prompt: string }[];
  producer?: string; producer_limit?: number; producer_prompt?: string;
  work_dir?: string; roles: { name: string; title?: string; agent_kind?: "source" | "local"; source_agent?: string; instance_ordinal?: number; template?: string; capabilities?: string[]; replica_eligible?: boolean; description: string; prompt: string; model?: string; appearance?: { color?: string; avatar?: string } }[];
  copilot?: { model?: string; [key: string]: unknown };
}
interface ProjectRegistration { config: Config; root: string; id: string; paused: boolean; base: Project; }
type ProjectDatabaseFactory = (file: string) => DatabaseSync;
export interface ProjectReadDiagnostic { configPath: string; error: string; }

export function getProjects(openDatabase: ProjectDatabaseFactory = openProjectDatabase): Project[] {
  return getProjectListing(openDatabase).projects;
}

export function getProjectListing(openDatabase: ProjectDatabaseFactory = openProjectDatabase) {
  const projects: Project[] = [];
  const diagnostics = new Map<string, ProjectReadDiagnostic>();
  const cacheable = openDatabase === openProjectDatabase;
  const configPaths = getProjectConfigPaths();
  if (cacheable) forgetProjects(configPaths);
  for (const configPath of configPaths) {
    if (cacheable) {
      const reusable = cachedProject(configPath);
      if (reusable) {
        projects.push(reusable);
        continue;
      }
    }
    let registration: ProjectRegistration;
    try {
      registration = readProjectRegistration(configPath);
    } catch (error) {
      const detail = errorDetail(error);
      const key = `${configPath}\0${detail}`;
      if (!diagnostics.has(key)) {
        diagnostics.set(key, { configPath, error: detail });
        console.error(`Skipping invalid project registration "${configPath}": ${detail}`);
      }
      continue;
    }
    // Sample inputs before reading so a write that lands mid-read is never cached as fresh.
    const fingerprint = cacheable ? projectInputFingerprint(configPath, registration.root) : "";
    const project = readProject(registration, openDatabase);
    if (cacheable) storeProject(configPath, registration.root, fingerprint, project);
    projects.push(project);
  }
  return { projects, diagnostics: [...diagnostics.values()] };
}
export function getProject(id: string) {
  return getProjects().find((project) => project.id === id);
}

export function getProjectRuntime(id: string) {
  const configPath = getProjectConfigPath(id);
  if (!configPath) return undefined;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;
  migrateLegacyProjectModel(configPath, config as ModelProjectConfig);
  if (migrateAgentRelationships(config as ModelProjectConfig)) writeProjectConfig(configPath, config);
  const leader = config.leader || config.roles[0]?.name;
  return {
    id,
    root: canonicalWorkspaceRoot(path.resolve(path.dirname(configPath), config.root)),
    paused: existsSync(path.join(path.dirname(configPath), ".cairn-paused")),
    agents: config.roles.map((role) => ({
      id: role.name,
      title: role.title || displayName(role.name),
      isLeader: role.name === leader,
    })),
  };
}

export function getConversation(projectId: string, agentId: string, before?: string, focusId?: string, limit = 30): ConversationPage | null {
  const project = getProject(projectId);
  const agent = project?.agents.find((candidate) => candidate.id === agentId);
  if (!project || !agent) return null;
  const dbPath = path.join(project.root, ".cairn-harness", "harness.db");
  if (!existsSync(dbPath)) return { items: [], hasMore: false };
  const db = openDatabase(dbPath, { readOnly: true });
  try {
    return readConversationPage(db, project.root, agent, before, focusId, limit);
  } finally {
    db.close();
  }
}
function readProjectRegistration(configPath: string): ProjectRegistration {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;
  migrateLegacyProjectModel(configPath, config as ModelProjectConfig);
  if (migrateAgentRelationships(config as ModelProjectConfig)) writeProjectConfig(configPath, config);
  const root = canonicalWorkspaceRoot(path.resolve(path.dirname(configPath), config.root));
  const id = path.basename(path.dirname(configPath));
  const paused = existsSync(path.join(path.dirname(configPath), ".cairn-paused"));
  const leader = config.leader || config.roles[0]?.name;
  const ideaAgents = ideaAgentConfig(config);
  const ideaIds = new Set(ideaAgents.filter((idea) => idea.agentId !== leader).map((idea) => idea.agentId));
  const base: Project = {
    id, name: config.name, root, workDir: config.work_dir, paused,
    leaderTaskLimit: config.leader_task_limit || 3, maxActiveTasks: config.max_active_tasks,
    delegatedTaskCount: 0, backlogTaskCount: 0, ideaAgents,
    agents: config.roles.map((role) => ({
      ...roleAgent(role, leader, ideaIds, config.configuration_revision || 0),
      ...replicaMetadata(config.roles, role),
    })).sort(leaderFirst), workItems: [], delegatedActions: [],
    activity: [], releases: 0, workItemCount: 0, activeWorkCount: 0,
    drafts: readDrafts(root, id),
  };
  return { config, root, id, paused, base };
}

function readProject({ config, root, id, paused, base }: ProjectRegistration, openDatabase: ProjectDatabaseFactory): Project {
  const dbPath = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(dbPath)) return base;
  const db = openDatabase(dbPath);
  try {
    const malformedTurns = new Set<string>();
    const activityFor = (row: Record<string, unknown>) => dbActivity(row, id, malformedTurns);
    const recoverableRootWork = readRecoverableRootWork(db);
    const runtimeAgents = new Map(all(db, "SELECT agent_id,role,status,current_topic,updated_at FROM agents ORDER BY agent_id")
      .map((row) => {
        const agentId = String(row.agent_id);
        return [agentId, dbAgent(row, recoverableRootWorkFor(recoverableRootWork, agentId))];
      }));
    const latest = latestAgentRows(db, config.roles.map((role) => role.name));
    const leader = config.leader || config.roles[0]?.name;
    const ideaAgents = ideaAgentConfig(config).map((idea) => ({
      ...idea,
      activeTaskCount: count(db, `SELECT COUNT(*) count FROM tasks
        WHERE kind='root' AND source='automatic' AND creator=?
        AND status IN ('pending','claimed','waiting','deferred','buffered','backlog')`, idea.agentId),
    }));
    const ideaIds = new Set(ideaAgents.filter((idea) => idea.agentId !== leader).map((idea) => idea.agentId));
    const agents = config.roles
      .map((role) => runtimeAgents.has(role.name)
        ? {
            ...runtimeAgents.get(role.name)!,
            title: role.title || displayName(role.name),
            role: role.description,
            configurationRevision: config.configuration_revision || 0,
          }
        : roleAgent(role, leader, ideaIds, config.configuration_revision || 0))
      .map((agent) => {
        const role = config.roles.find((candidate) => candidate.name === agent.id);
        const sourceRole = role?.agent_kind === "local"
          ? config.roles.find((candidate) => candidate.name === role.source_agent) || role
          : role;
        const effectiveRole = role && sourceRole && legacyOverrideFields(role, sourceRole).length ? role : sourceRole;
        return withLatestMessage({
          ...agent,
          title: effectiveRole?.title || agent.title,
          role: effectiveRole?.description || agent.role,
          prompt: effectiveRole?.prompt,
          model: effectiveRole?.model,
          ...(role ? replicaMetadata(config.roles, role) : {}),
          configurationRevision: config.configuration_revision || 0,
          isLeader: agent.id === leader,
          isIdeaAgent: ideaIds.has(agent.id),
        }, latest, activityFor);
      })
      .map((agent) => paused ? { ...agent, status: "paused" as const, topic: undefined } : agent)
      .sort(leaderFirst);
    const activity = all(db, `SELECT sequence,agent_id,status,output_json,completed_at,
      ${activityContextColumns(db)} FROM turns ORDER BY sequence DESC LIMIT 12`).map(activityFor);
    const supersededReviewTasks = readSupersededReviewTaskIds(db);
    const workItems = all(db, `SELECT id,parent_id,kind,body,status,creator,assignee,topic,created_at,
        COALESCE(completed_at,claimed_at,created_at) updated_at FROM tasks
      WHERE kind='root' AND status NOT IN ('done','completed','released','cancelled','failed')
      UNION ALL
      SELECT id,parent_id,kind,body,status,creator,assignee,topic,created_at,updated_at FROM (
        SELECT id,parent_id,kind,body,status,creator,assignee,topic,created_at,
          COALESCE(completed_at,claimed_at,created_at) updated_at FROM tasks
        WHERE kind='root' AND status IN ('done','completed','released','cancelled','failed')
        ORDER BY created_at DESC,id DESC LIMIT 20
      )
      ORDER BY created_at DESC,id DESC`).map((row) => rootTaskItem(
        row,
        paused,
        supersededReviewTasks.has(String(row.id)) ? "superseded" : undefined,
      ));
    const delegatedActions = readDelegatedActions(db, paused);
    const releases = count(db, "SELECT COUNT(*) count FROM releases");
    const workItemCount = count(db, `SELECT COUNT(*) count FROM tasks WHERE ${manualLeaderWorkItemRoot}`, leader);
    const activeWorkCount = count(db, `SELECT COUNT(*) count FROM tasks WHERE ${manualLeaderWorkItemRoot}
      AND status IN ('pending','claimed','waiting','deferred')`, leader);
    const delegatedTaskCount = count(db, `SELECT COUNT(*) count FROM tasks
      WHERE kind='delegation' AND source='agent' AND status IN ('pending','claimed','waiting','deferred')`);
    const backlogTaskCount = count(db, `SELECT COUNT(*) count FROM tasks WHERE
      (kind='delegation' AND source='agent' AND status IN ('buffered','backlog'))
      OR (${manualLeaderWorkItemRoot} AND status='backlog')`, leader);
    return { ...base, agents, ideaAgents, activity, workItems, delegatedActions, releases, workItemCount, activeWorkCount, delegatedTaskCount, backlogTaskCount };
  } finally {
    db.close();
  }
}

function replicaMetadata(roles: Config["roles"], role: Config["roles"][number]) {
  const sourceAgentId = role.source_agent || role.name;
  const kind = role.agent_kind || "source";
  const configuredSource = roles.find((candidate) => candidate.name === sourceAgentId);
  const source = configuredSource || role;
  const sourceExists = kind !== "local" || Boolean(configuredSource);
  const inherited = kind === "local" ? legacyOverrideFields(role, source) : [];
  return {
    kind,
    sourceAgentId,
    instanceOrdinal: role.instance_ordinal || 0,
    legacyOverrides: inherited.length ? inherited : undefined,
    appearance: source.appearance,
    capabilities: {
      configure: kind !== "local",
      pause: sourceExists,
      resume: sourceExists,
      reset: sourceExists,
      delete: sourceExists,
      promote: kind !== "local",
    },
  };
}

function legacyOverrideFields(role: Config["roles"][number], source: Config["roles"][number]) {
  return ["title", "description", "prompt", "model", "capabilities", "appearance"].filter((field) => {
    const local = role[field as keyof typeof role];
    const canonical = source[field as keyof typeof source];
    return local !== undefined && JSON.stringify(local) !== JSON.stringify(canonical);
  });
}

function openProjectDatabase(file: string) {
  return openDatabase(file, { readOnly: true });
}

function errorDetail(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function all(db: DatabaseSync, sql: string, ...parameters: string[]) {
  return db.prepare(sql).all(...parameters) as Record<string, unknown>[];
}
function count(db: DatabaseSync, sql: string, ...parameters: string[]) {
  return Number((db.prepare(sql).get(...parameters.map(String)) as { count: number }).count);
}
function readContent(root: string, relative: string) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root)) || !existsSync(file)) return "";
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}
function roleAgent(role: Config["roles"][number], leader: string | undefined, ideaAgents: Set<string>, configurationRevision: number): Agent {
  return { id: role.name, kind: role.agent_kind || "source", sourceAgentId: role.source_agent || role.name, instanceOrdinal: role.instance_ordinal || 0, configurationRevision, title: role.title || displayName(role.name), role: role.description, prompt: role.prompt, model: role.model, isLeader: role.name === leader, isIdeaAgent: ideaAgents.has(role.name), status: "idle", updatedAt: "" };
}
function ideaAgentConfig(config: Config): IdeaAgent[] {
  const rolePrompt = (agentId: string) => config.roles?.find((role) => role.name === agentId)?.prompt;
  const configured = config.idea_agents?.map((idea) => ({
    agentId: idea.agent,
    taskLimit: idea.task_limit,
    prompt: rolePrompt(idea.agent) ?? idea.prompt,
    activeTaskCount: 0,
  }));
  if (configured?.length) return configured;
  return config.producer ? [{
    agentId: config.producer,
    taskLimit: config.producer_limit || 1,
    prompt: rolePrompt(config.producer) ?? config.producer_prompt ?? "Create a new task for this project.",
    activeTaskCount: 0,
  }] : [];
}
function displayName(id: string) { return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function leaderFirst(a: Agent, b: Agent) {
  return Number(Boolean(b.isLeader)) - Number(Boolean(a.isLeader)) || a.id.localeCompare(b.id);
}
function dbAgent(row: Record<string, unknown>, recoverableRootWork: RecoverableRootWork): Agent {
  const status = String(row.status) as Agent["status"];
  const id = String(row.agent_id);
  return { id, kind: "source", sourceAgentId: id, instanceOrdinal: 0, role: String(row.role), status: projectAgentStatus(status, recoverableRootWork), topic: row.current_topic ? String(row.current_topic) : undefined, updatedAt: String(row.updated_at) };
}
interface LatestAgentRows {
  tasks: Map<string, Record<string, unknown>>;
  turns: Map<string, Record<string, unknown>>;
}
function latestAgentRows(db: DatabaseSync, agentIds: string[]): LatestAgentRows {
  const ids = [...new Set(agentIds)];
  if (!ids.length) return { tasks: new Map(), turns: new Map() };
  const configuredAgentIds = JSON.stringify(ids);
  const tasks = all(db, `/* latest-agent-task */
    WITH configured(agent_id) AS (SELECT value FROM json_each(?)),
    ranked AS (
      SELECT configured.agent_id, tasks.body, tasks.created_at,
        ROW_NUMBER() OVER (PARTITION BY configured.agent_id ORDER BY tasks.created_at DESC) AS latest_rank
      FROM configured
      JOIN tasks ON tasks.creator=configured.agent_id OR tasks.assignee=configured.agent_id
    )
    SELECT agent_id,body,created_at FROM ranked WHERE latest_rank=1`, configuredAgentIds);
  const turns = all(db, `/* latest-agent-turn */
    WITH configured(agent_id) AS (SELECT value FROM json_each(?)),
    ranked AS (
      SELECT turns.sequence,turns.agent_id,turns.status,turns.output_json,turns.completed_at,
        ROW_NUMBER() OVER (PARTITION BY turns.agent_id ORDER BY turns.sequence DESC) AS latest_rank
      FROM configured
      JOIN turns ON turns.agent_id=configured.agent_id
    )
    SELECT sequence,agent_id,status,output_json,completed_at FROM ranked WHERE latest_rank=1`, configuredAgentIds);
  return {
    tasks: new Map(tasks.map((row) => [String(row.agent_id), row])),
    turns: new Map(turns.map((row) => [String(row.agent_id), row])),
  };
}
function withLatestMessage(agent: Agent, latest: LatestAgentRows, activityFor: (row: Record<string, unknown>) => Activity): Agent {
  const message = latest.tasks.get(agent.id);
  const turn = latest.turns.get(agent.id);
  if (!message && !turn) return agent;
  const turnBody = turn ? activityFor(turn).summary : "";
  const useTurn = turn && (!message || String(turn.completed_at) > String(message.created_at));
  const body = useTurn ? turnBody : String(message?.body || "");
  return { ...agent, lastMessage: body.replace(/\s+/g, " ").slice(0, 160), lastMessageAt: String(useTurn ? turn?.completed_at : message?.created_at) };
}
function dbActivity(row: Record<string, unknown>, projectId: string, malformedTurns: Set<string>): Activity {
  const { output, malformed } = parseTurnOutput(row.output_json);
  const sequence = Number(row.sequence);
  const agent = String(row.agent_id);
  if (malformed) {
    const key = `${sequence}\0${agent}`;
    if (!malformedTurns.has(key)) {
      malformedTurns.add(key);
      console.error(`Could not parse persisted turn output for project "${projectId}" at sequence ${sequence} (agent "${agent}")`);
    }
  }
  const persistedSummary = output.summary || "Completed work";
  const summary = !malformed && isGenericCompletion(persistedSummary)
    ? contextualCompletionSummary(row) || persistedSummary
    : persistedSummary;
  return { id: sequence, agent, summary: malformed ? "Malformed turn output" : summary, status: String(row.status), completedAt: String(row.completed_at), chatId: `turn:${row.sequence}` };
}
function activityContextColumns(db: DatabaseSync) {
  const columns = new Set((db.prepare("PRAGMA table_info(turns)").all() as Array<{ name?: unknown }>).map((column) => String(column.name)));
  return [
    columns.has("inbound_topic") ? "inbound_topic AS activity_topic" : "NULL AS activity_topic",
    columns.has("inbound_body") ? "inbound_body AS activity_body" : "NULL AS activity_body",
  ].join(",");
}
function isGenericCompletion(summary: string) {
  return /^completed (?:the )?(?:deliverable|work)[.!]?$/i.test(summary.trim());
}
function contextualCompletionSummary(row: Record<string, unknown>) {
  const topic = String(row.activity_topic || "").trim();
  const firstLine = String(row.activity_body || "").split(/\r?\n/).find((line) => line.trim())?.trim();
  const context = !isGenericActivityTopic(topic) ? topic : firstLine;
  return context ? `Completed: ${context}` : "";
}
function isGenericActivityTopic(topic: string) {
  return !topic || /^(?:work-item|dashboard-message|task)$/i.test(topic);
}
function documentLabel(content: string) {
  const first = content.split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !/^[a-z_-]+:\s/i.test(line));
  return first?.slice(0, 80) || "Untitled task";
}
function readDrafts(root: string, projectId: string): QueueItem[] {
  const directory = path.join(root, ".cairn-harness", "drafts");
  if (!existsSync(directory)) return [];
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    console.error(`Could not enumerate drafts for project "${projectId}" at "${directory}": ${errorDetail(error)}`);
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => {
      const content = readContent(root, path.join(".cairn-harness", "drafts", name));
      return content.trim()
        ? [{ id: path.basename(name, ".md"), title: documentLabel(content), meta: name, status: "draft", content }]
        : [];
    });
}

