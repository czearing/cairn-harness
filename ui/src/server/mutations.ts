import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import { ensureOperatorPauseTable, OPERATOR_PAUSE_ERROR } from "./agent-pause-state";
import { getProject, getProjectConfigPath, getProjectRuntime } from "./projects";
import { ensureProjectRunning } from "./supervisor";
import { restartProject } from "./supervisor";
import { clearAgentContextState } from "./agent-context";
import { persistDraftSubmission } from "./draft-submission";
import { writeProjectDocument } from "./document-save";
import { persistTaskSubmission } from "./task-submission";
import { writeProjectConfig } from "./project-config-write";
import { migrateAgentRelationships, validateModelOverride, type ConfigRole } from "./model-config";
import type { ModelCatalogEntry } from "./model-catalog";

export { createProject } from "./project-registry";

type Role = ConfigRole;
interface DeleteAgentDependencies {
  writeProjectConfig: typeof writeProjectConfig;
}
export interface AgentCapabilityMatrix {
  configure: boolean;
  pause: boolean;
  resume: boolean;
  reset: boolean;
  delete: boolean;
  promote: boolean;
  delegate: boolean;
}
export interface AgentDeletionOperation {
  id: string;
  idempotencyKey: string;
  targetId: string;
  targetKind: "source" | "local";
  affectedIds: string[];
  state: "pending_cleanup" | "completed" | "cleanup_attention";
  revision: number;
  error?: string;
}
interface RevisionedConfig {
  configuration_revision?: number;
  root: string;
  leader?: string;
  idea_agents?: { agent: string }[];
  producer?: string;
  roles?: Role[];
  agent_deletion_operations?: AgentDeletionOperation[];
}
export class InvalidMessageRecipientError extends Error {}
export class ManagedBySourceAgentError extends Error {
  readonly status = 409;
  readonly sourceAgentId: string;

  constructor(sourceAgentId: string) {
    super(`Managed by source agent ${sourceAgentId}`);
    this.sourceAgentId = sourceAgentId;
  }
}

export class AgentRevisionConflictError extends Error {
  readonly status = 409;
  readonly latestRevision: number;

  constructor(latestRevision: number) {
    super("This agent changed elsewhere. Review latest.");
    this.latestRevision = latestRevision;
  }
}

export function getAgentConfigurationRevision(projectId: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as RevisionedConfig;
  return config.configuration_revision || 0;
}

export function assertAgentConfigurationRevision(projectId: string, expectedRevision: number) {
  const latestRevision = getAgentConfigurationRevision(projectId);
  if (expectedRevision !== latestRevision) throw new AgentRevisionConflictError(latestRevision);
}

function writeAgentConfig(configPath: string, config: RevisionedConfig, writer: typeof writeProjectConfig = writeProjectConfig) {
  config.configuration_revision = (config.configuration_revision || 0) + 1;
  writer(configPath, config);
  return config.configuration_revision;
}

function requireEditableSource(config: { roles?: Role[] }, agentId: string) {
  migrateAgentRelationships(config);
  const role = config.roles?.find((candidate) => candidate.name === agentId);
  if (!role) throw new Error("Agent not found");
  if (role.agent_kind === "local") throw new ManagedBySourceAgentError(role.source_agent || agentId);
  return role;
}

function managedLocals(config: { roles?: Role[] }, source: Role) {
  return (config.roles || []).filter((role) =>
    role.agent_kind === "local" && role.source_agent === source.name);
}

export function agentCapabilityMatrix(projectId: string, agentId: string): AgentCapabilityMatrix {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as RevisionedConfig;
  migrateAgentRelationships(config);
  const role = config.roles?.find((candidate) => candidate.name === agentId);
  if (!role) throw new Error("Agent not found");
  const sourceExists = role.agent_kind !== "local"
    || config.roles?.some((candidate) => candidate.name === role.source_agent);
  return {
    configure: role.agent_kind !== "local",
    pause: Boolean(sourceExists),
    resume: Boolean(sourceExists),
    reset: Boolean(sourceExists),
    delete: Boolean(sourceExists),
    promote: role.agent_kind !== "local" && config.leader !== role.name,
    delegate: role.agent_kind !== "local" && config.leader !== role.name,
  };
}

export function assertAgentCapability(projectId: string, agentId: string, capability: keyof AgentCapabilityMatrix) {
  if (!agentCapabilityMatrix(projectId, agentId)[capability]) {
    throw Object.assign(new Error(`Agent capability "${capability}" is not available.`), {
      status: 409,
      code: "capability_unavailable",
    });
  }
}

export function sendMessage(projectId: string, agent: string, body: string, submissionId?: string) {
  const project = requiredProject(projectId);
  if (!project.agents.some((candidate) => candidate.id === agent)) throw new InvalidMessageRecipientError("This agent is no longer available in this project. Refresh and select an available agent.");
  return persistTaskSubmission({
    projectId,
    root: project.root,
    paused: project.paused === true,
    kind: "message",
    source: "message",
    assignee: agent,
    topic: "dashboard-message",
    body,
    submissionId,
  }, ensureProjectRunning);
}

export function createWorkItem(projectId: string, body: string) {
  const project = requiredProject(projectId);
  const leader = project.agents.find((agent) => agent.isLeader)?.id || project.agents[0]?.id;
  if (!leader) throw new Error("Create an agent before sending a task");
  return persistTaskSubmission({
    projectId,
    root: project.root,
    paused: project.paused === true,
    kind: "root",
    source: "manual",
    assignee: leader,
    topic: "work-item",
    body: body.trim(),
  }, ensureProjectRunning);
}

export function submitDraft(projectId: string, id: string, body: string) {
  const project = getProjectRuntime(projectId);
  if (!project) throw new Error("Project not found");
  const leader = project.agents.find((agent) => agent.isLeader)?.id || project.agents[0]?.id;
  if (!leader) throw new Error("Create an agent before sending a task");
  const persisted = persistDraftSubmission(project.root, leader, id, body);
  if (project.paused) return { ...persisted, workerStarted: false };
  try {
    return { ...persisted, workerStarted: ensureProjectRunning(projectId) };
  } catch (error) {
    return {
      ...persisted,
      workerStarted: false,
      workerError: error instanceof Error ? error.message : "Project worker did not start",
    };
  }
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
  const role = requireEditableSource(config, agentId);
  if (!prompt.trim()) throw new Error("Instructions are required.");
  const previous = role.prompt;
  const next = prompt.trim();
  for (const local of managedLocals(config, role)) {
    if (local.prompt === previous) local.prompt = next;
  }
  role.prompt = next;
  validateAgentConfig(config, agentId);
  writeAgentConfig(configPath, config as RevisionedConfig);
  validatePersistedAgentConfig(configPath, agentId);
}

export function updateAgentDetails(projectId: string, agentId: string, title: string, description: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { roles?: Role[] };
  const role = requireEditableSource(config, agentId);
  if (!title.trim()) throw new Error("Title is required.");
  if (!description.trim()) throw new Error("Description is required.");
  const previousTitle = role.title;
  const previousDescription = role.description;
  const nextTitle = title.trim();
  const nextDescription = description.trim();
  for (const local of managedLocals(config, role)) {
    if (local.title === previousTitle) local.title = nextTitle;
    if (local.description === previousDescription) local.description = nextDescription;
  }
  role.title = nextTitle;
  role.description = nextDescription;
  validateAgentConfig(config, agentId);
  writeAgentConfig(configPath, config as RevisionedConfig);
  validatePersistedAgentConfig(configPath, agentId);
}

export function updateAgentModel(projectId: string, agentId: string, model?: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { roles?: Role[] };
  const role = requireEditableSource(config, agentId);
  const previous = role.model;
  const next = model?.trim() || undefined;
  for (const local of managedLocals(config, role)) {
    if (local.model === previous) {
      if (next) local.model = next;
      else delete local.model;
    }
  }
  if (next) role.model = next;
  else delete role.model;
  validateAgentConfig(config, agentId);
  writeAgentConfig(configPath, config as RevisionedConfig);
  validatePersistedAgentConfig(configPath, agentId);
}

export function updateAgentConfiguration(
  projectId: string,
  agentId: string,
  values: { title: string; description: string; prompt: string; model?: string },
  catalog: ModelCatalogEntry[],
) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { roles?: Role[] };
  const role = requireEditableSource(config, agentId);
  if (!values.title.trim() || !values.description.trim() || !values.prompt.trim()) {
    throw new Error("Title, description, and instructions are required");
  }

  const previous = {
    title: role.title,
    description: role.description,
    prompt: role.prompt,
    model: role.model,
  };
  const next = {
    title: values.title.trim(),
    description: values.description.trim(),
    prompt: values.prompt.trim(),
    model: validateModelOverride(values.model, catalog),
  };
  for (const local of managedLocals(config, role)) {
    if (local.title === previous.title) local.title = next.title;
    if (local.description === previous.description) local.description = next.description;
    if (local.prompt === previous.prompt) local.prompt = next.prompt;
    if (local.model === previous.model) {
      if (next.model) local.model = next.model;
      else delete local.model;
    }
  }
  role.title = next.title;
  role.description = next.description;
  role.prompt = next.prompt;
  if (next.model) role.model = next.model;
  else delete role.model;
  validateAgentConfig(config, agentId);
  writeAgentConfig(configPath, config as RevisionedConfig);
  validatePersistedAgentConfig(configPath, agentId);
}

export function updateAgentAppearance(
  projectId: string,
  agentId: string,
  appearance: { color?: string; avatar?: string },
) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as RevisionedConfig;
  const role = requireEditableSource(config, agentId);
  const color = appearance.color?.trim();
  const avatar = appearance.avatar?.trim();
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Appearance color must be a six-digit hex color.");
  if (avatar && !avatar.startsWith("data:image/")) throw new Error("Appearance avatar must be an image data URL.");
  role.appearance = {
    ...(color ? { color } : {}),
    ...(avatar ? { avatar } : {}),
  };
  if (!Object.keys(role.appearance).length) delete role.appearance;
  for (const local of managedLocals(config, role)) delete local.appearance;
  writeAgentConfig(configPath, config);
}

export function validatePersistedAgentConfig(configPath: string, agentId: string) {
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { roles?: Role[] };
    validateAgentConfig(config, agentId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Saved agent config could not be reloaded: ${detail}`);
  }
}

function validateAgentConfig(config: { roles?: Role[] }, agentId: string) {
  const roles = config.roles;
  if (!Array.isArray(roles) || !roles.length) throw new Error("roles are missing");
  const names = new Set<string>();
  for (const role of roles) {
    if (
      typeof role.name !== "string"
      || typeof role.description !== "string"
      || typeof role.prompt !== "string"
      || names.has(role.name)
    ) {
      throw new Error("roles are invalid");
    }
    names.add(role.name);
  }
  if (!names.has(agentId)) throw new Error("saved agent is missing");
}

export function addAgent(projectId: string, name: string, description: string, prompt: string, model: string | undefined, catalog: ModelCatalogEntry[], replicaOf?: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const id = slug(name);
  if (!id || !description.trim() || !prompt.trim()) throw new Error("Name, role, and instructions are required");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { leader?: string; roles?: Role[] };
  const roles = config.roles || [];
  if (roles.some((role) => role.name === id)) throw new Error("An agent with this name already exists");
  const role: Role = { name: id, title: name.trim(), description: description.trim(), prompt: prompt.trim() };
  const override = validateModelOverride(model, catalog);
  if (override) role.model = override;
  if (replicaOf) configureReplicaRole(roles, role, replicaOf);
  config.roles = [...roles, role];
  if (!config.leader) config.leader = id;
  writeAgentConfig(configPath, config as RevisionedConfig);
  return id;
}

// Makes a new agent a parallel replica of an existing role: the harness routes root work to
// whichever pool member is idlest instead of always the same agent. Replicas stay fully visible
// and independently configurable (agent_kind stays "source"), unlike the unrelated "local" agent
// concept, so the relationship is easy to see and edit from the site rather than hidden.
function configureReplicaRole(roles: Role[], role: Role, replicaOf: string) {
  const template = roles.find((candidate) => candidate.name === replicaOf);
  if (!template) throw new Error("Replica source agent not found");
  if (template.agent_kind === "local") throw new Error("Cannot replicate a managed local agent");
  const templateId = template.replica_eligible && template.template ? template.template : template.name;
  const pool = roles.filter((candidate) => candidate.name === templateId || candidate.template === templateId);
  const nextOrdinal = Math.max(0, ...pool.map((candidate) => candidate.instance_ordinal || 0)) + 1;
  role.template = templateId;
  role.replica_eligible = true;
  role.source_agent = templateId;
  role.instance_ordinal = nextOrdinal;
  role.agent_kind = "source";
  if (!template.replica_eligible || template.template !== templateId) {
    template.replica_eligible = true;
    template.template = templateId;
    template.agent_kind ||= "source";
    template.source_agent ||= template.name;
    if (template.instance_ordinal === undefined) template.instance_ordinal = 0;
  }
}

export function deleteAgent(
  projectId: string,
  agentId: string,
  options: Partial<DeleteAgentDependencies> & { expectedRevision?: number; idempotencyKey?: string } = {},
): AgentDeletionOperation {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const initial = JSON.parse(readFileSync(configPath, "utf8")) as RevisionedConfig;
  const idempotencyKey = options.idempotencyKey || randomUUID();
  const existing = initial.agent_deletion_operations?.find((operation) => operation.idempotencyKey === idempotencyKey);
  if (existing) return existing;
  const databasePath = path.join(path.resolve(path.dirname(configPath), initial.root), ".cairn-harness", "harness.db");
  if (!existsSync(databasePath)) {
    return commitAgentDeletion(configPath, initial, agentId, idempotencyKey, options.expectedRevision, options.writeProjectConfig || writeProjectConfig);
  }

  const db = openDatabase(databasePath);
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const config = JSON.parse(readFileSync(configPath, "utf8")) as RevisionedConfig;
    const operation = prepareAgentDeletion(config, agentId, idempotencyKey, options.expectedRevision);
    const affectedIds = operation.affectedIds;
    const placeholders = affectedIds.map(() => "?").join(",");
    const active = db.prepare(`SELECT assignee FROM tasks
      WHERE assignee IN (${placeholders}) AND status IN ('pending','claimed','waiting','deferred','buffered','backlog')
      LIMIT 1`).get(...affectedIds) as { assignee?: string } | undefined;
    if (active) throw new Error("Finish or cancel this agent's active work before deleting it");
    writeAgentConfig(configPath, config, options.writeProjectConfig || writeProjectConfig);
    operation.revision = config.configuration_revision || operation.revision;
    db.exec("COMMIT");
    transactionOpen = false;
    return operation;
  } catch (error) {
    if (transactionOpen) {
      try { db.exec("ROLLBACK"); } catch {}
    }
    throw error;
  } finally {
    db.close();
  }
}

function commitAgentDeletion(
  configPath: string,
  config: RevisionedConfig,
  agentId: string,
  idempotencyKey: string,
  expectedRevision: number | undefined,
  writer: typeof writeProjectConfig,
) {
  const operation = prepareAgentDeletion(config, agentId, idempotencyKey, expectedRevision);
  writeAgentConfig(configPath, config, writer);
  operation.revision = config.configuration_revision || operation.revision;
  return operation;
}

// A "source" role's own source_agent field may point at its routing-pool template (for
// replicas), not a parent it inherits from — so deleting a role only cascades to true
// dependents (agent_kind="local" clones), never to independent replica siblings that merely
// share the same routing group.
function deletionScope(roles: ConfigRole[], selected: ConfigRole) {
  return roles.filter((role) => role.name === selected.name
    || (role.agent_kind === "local" && (role.source_agent || role.name) === selected.name));
}

function prepareAgentDeletion(
  config: RevisionedConfig,
  agentId: string,
  idempotencyKey: string,
  expectedRevision?: number,
) {
  const latestRevision = config.configuration_revision || 0;
  if (expectedRevision !== undefined && expectedRevision !== latestRevision) throw new AgentRevisionConflictError(latestRevision);
  migrateAgentRelationships(config);
  const roles = config.roles || [];
  const selected = roles.find((role) => role.name === agentId);
  if (!selected) throw new Error("Agent not found");
  const affected = deletionScope(roles, selected);
  const affectedIds = affected.map((role) => role.name);
  if (config.leader && affectedIds.includes(config.leader)) throw new Error("Reassign leadership before deleting this agent");
  const operation: AgentDeletionOperation = {
    id: randomUUID(),
    idempotencyKey,
    targetId: selected.name,
    targetKind: selected.agent_kind || "source",
    affectedIds,
    state: "pending_cleanup",
    revision: latestRevision + 1,
  };
  config.roles = roles.filter((role) => !affectedIds.includes(role.name));
  config.idea_agents = config.idea_agents?.filter((idea) => !affectedIds.includes(idea.agent));
  if (config.producer && affectedIds.includes(config.producer)) delete config.producer;
  config.agent_deletion_operations = [...(config.agent_deletion_operations || []), operation].slice(-50);
  return operation;
}

export function completeAgentDeletionOperation(projectId: string, operationId: string, error?: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as RevisionedConfig;
  const operation = config.agent_deletion_operations?.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error("Deletion operation not found");
  operation.state = error ? "cleanup_attention" : "completed";
  if (error) operation.error = error;
  else delete operation.error;
  writeProjectConfig(configPath, config);
  return operation;
}

export interface AgentDeletionPreview {
  revision: number;
  targetId: string;
  targetKind: "source" | "local";
  affected: Array<{ id: string; kind: "source" | "local"; status: string; currentClaim?: string }>;
  blockers: Array<{ code: "leader" | "active_work"; agentId: string; status?: string; claimId?: string }>;
  canDelete: boolean;
}

export function previewAgentDeletion(projectId: string, agentId: string): AgentDeletionPreview {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as RevisionedConfig;
  migrateAgentRelationships(config);
  const roles = config.roles || [];
  const selected = roles.find((role) => role.name === agentId);
  if (!selected) throw new Error("Agent not found");
  const affectedRoles = deletionScope(roles, selected);
  const runtime = new Map<string, { status: string; currentClaim?: string }>();
  const blockers: AgentDeletionPreview["blockers"] = [];
  const databasePath = path.join(path.resolve(path.dirname(configPath), config.root), ".cairn-harness", "harness.db");
  if (existsSync(databasePath)) {
    const db = openDatabase(databasePath, { readOnly: true });
    try {
      const ids = affectedRoles.map((role) => role.name);
      const placeholders = ids.map(() => "?").join(",");
      if (ids.length) {
        for (const row of db.prepare(`SELECT agent_id,status,current_topic FROM agents WHERE agent_id IN (${placeholders})`).all(...ids) as Array<{ agent_id: string; status: string; current_topic?: string }>) {
          runtime.set(row.agent_id, { status: row.status, currentClaim: row.current_topic || undefined });
        }
        for (const row of db.prepare(`SELECT id,assignee,status FROM tasks WHERE assignee IN (${placeholders})
          AND status IN ('pending','claimed','waiting','deferred','buffered','backlog') ORDER BY id`).all(...ids) as Array<{ id: string; assignee: string; status: string }>) {
          blockers.push({ code: "active_work", agentId: row.assignee, status: row.status, claimId: row.id });
        }
      }
    } finally {
      db.close();
    }
  }
  if (config.leader && affectedRoles.some((role) => role.name === config.leader)) {
    blockers.unshift({ code: "leader", agentId: config.leader });
  }
  return {
    revision: config.configuration_revision || 0,
    targetId: selected.name,
    targetKind: selected.agent_kind || "source",
    affected: affectedRoles.map((role) => ({
      id: role.name,
      kind: role.agent_kind || "source",
      status: runtime.get(role.name)?.status || "not-running",
      currentClaim: runtime.get(role.name)?.currentClaim,
    })),
    blockers,
    canDelete: blockers.length === 0,
  };
}

export function clearAgentContext(projectId: string, agentId: string) {
  const project = requiredProject(projectId);
  clearAgentContextState(project.root, agentId);
  restartProject(projectId);
}

export function setProjectLeader(projectId: string, agentId: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { leader?: string; idea_agents?: { agent: string }[]; producer?: string; roles?: Role[] };
  if (!(config.roles || []).some((role) => role.name === agentId)) throw new Error("Agent not found");
  config.leader = agentId;
  config.idea_agents = config.idea_agents?.filter((idea) => idea.agent !== agentId);
  if (config.producer === agentId) delete config.producer;
  writeProjectConfig(configPath, config);
}

export function setAgentDelegate(projectId: string, agentId: string, canDelegate: boolean) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { leader?: string; delegate_agents?: string[]; roles?: Role[] };
  if (!(config.roles || []).some((role) => role.name === agentId)) throw new Error("Agent not found");
  if (config.leader === agentId) throw new Error("The project leader already delegates and cannot be listed separately.");
  const current = new Set(config.delegate_agents || []);
  if (canDelegate) current.add(agentId);
  else current.delete(agentId);
  config.delegate_agents = [...current];
  writeProjectConfig(configPath, config);
}

export function pauseAgent(projectId: string, agentId: string) {
  const project = requiredProject(projectId);
  const db = openDatabase(path.join(project.root, ".cairn-harness", "harness.db"));
  try {
    pauseAgentInDatabase(db, agentId, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function resumeAgent(projectId: string, agentId: string) {
  const project = requiredProject(projectId);
  const db = openDatabase(path.join(project.root, ".cairn-harness", "harness.db"));
  try {
    resumeAgentInDatabase(db, agentId, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function pauseAgentInDatabase(db: DatabaseSync, agentId: string, now: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureOperatorPauseTable(db);
    db.prepare("UPDATE tasks SET status='deferred',claimed_at=NULL,error=? WHERE assignee=? AND status='claimed'")
      .run(OPERATOR_PAUSE_ERROR, agentId);
    db.prepare("INSERT OR IGNORE INTO operator_pauses(agent_id) VALUES(?)").run(agentId);
    db.prepare("UPDATE agents SET status='paused',current_topic=NULL,updated_at=? WHERE agent_id=?").run(now, agentId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function resumeAgentInDatabase(db: DatabaseSync, agentId: string, now: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureOperatorPauseTable(db);
    db.prepare("UPDATE agents SET status='idle',current_topic=NULL,updated_at=? WHERE agent_id=?").run(now, agentId);
    db.prepare("DELETE FROM operator_pauses WHERE agent_id=?").run(agentId);
    db.prepare("UPDATE tasks SET status='pending',error=NULL WHERE assignee=? AND status='deferred' AND error=?")
      .run(agentId, OPERATOR_PAUSE_ERROR);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function saveDocument(projectId: string, relative: string, body: string) {
  const project = requiredProject(projectId);
  writeProjectDocument(project.root, relative, body);
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

