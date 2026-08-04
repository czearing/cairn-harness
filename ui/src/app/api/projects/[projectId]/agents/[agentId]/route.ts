import { AgentRevisionConflictError, assertAgentCapability, assertAgentConfigurationRevision, clearAgentContext, completeAgentDeletionOperation, deleteAgent, getAgentConfigurationRevision, ManagedBySourceAgentError, pauseAgent, previewAgentDeletion, resumeAgent, setProjectLeader, updateAgentAppearance, updateAgentConfiguration, updateAgentDetails, updateAgentModel, updateAgentPrompt, type AgentDeletionOperation } from "@/server/mutations";
import { restartProject } from "@/server/supervisor";
import { handleAgentPatch } from "./agent-actions";
import { getModelCatalog } from "@/server/model-catalog";

export const runtime = "nodejs";

interface AgentDeleteDependencies {
  deleteAgent: (projectId: string, agentId: string, options: { expectedRevision: number; idempotencyKey: string }) => AgentDeletionOperation;
  restartProject: (projectId: string) => void;
  completeOperation: typeof completeAgentDeletionOperation;
}

interface AgentPutDependencies {
  updateAgentPrompt: typeof updateAgentPrompt;
  updateAgentDetails: typeof updateAgentDetails;
  updateAgentModel: typeof updateAgentModel;
  updateAgentConfiguration: typeof updateAgentConfiguration;
  updateAgentAppearance: typeof updateAgentAppearance;
  getModelCatalog: typeof getModelCatalog;
  scheduleRestart: (projectId: string) => void;
  assertRevision?: typeof assertAgentConfigurationRevision;
  getRevision?: typeof getAgentConfigurationRevision;
}

interface AgentDeletionRestartDependencies {
  restartProject: typeof restartProject;
  schedule: (callback: () => void) => void;
  logError: (message: string, error: unknown) => void;
}

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  return handleAgentPut(request, projectId, agentId);
}

export async function handleAgentPut(
  request: Request,
  projectId: string,
  agentId: string,
  dependencies: AgentPutDependencies = {
    updateAgentPrompt,
    updateAgentDetails,
    updateAgentModel,
    updateAgentConfiguration,
    updateAgentAppearance,
    getModelCatalog,
    scheduleRestart: scheduleAgentDeletionRestart,
    assertRevision: assertAgentConfigurationRevision,
    getRevision: getAgentConfigurationRevision,
  },
) {
  const data = await request.json() as {
    details?: { title?: unknown; description?: unknown };
    instructions?: { prompt?: unknown };
    model?: string | { model?: unknown };
    prompt?: string;
    title?: string;
    description?: string;
    quantity?: unknown;
    appearance?: { color?: string; avatar?: string };
  };
  try {
    if (dependencies.assertRevision) dependencies.assertRevision(projectId, expectedRevision(request));
    if (data.quantity !== undefined) {
      throw Object.assign(new Error("Agent cloning is no longer supported."), { code: "clone_feature_removed" });
    } else if (data.appearance) {
      dependencies.updateAgentAppearance(projectId, agentId, data.appearance);
    } else if (data.details) {
      if (typeof data.details.title !== "string" || typeof data.details.description !== "string") throw new Error("Invalid agent details");
      dependencies.updateAgentDetails(projectId, agentId, data.details.title, data.details.description);
    } else if (data.instructions) {
      if (typeof data.instructions.prompt !== "string") throw new Error("Invalid agent instructions");
      dependencies.updateAgentPrompt(projectId, agentId, data.instructions.prompt);
    } else if (data.model && typeof data.model === "object") {
      if (data.model.model !== undefined && typeof data.model.model !== "string") throw new Error("Invalid agent model");
      const model = typeof data.model.model === "string" ? data.model.model.trim() : "";
      if (model) {
        const models = await dependencies.getModelCatalog();
        if (!models.some((candidate) => candidate.id === model)) throw new Error(`Model ${model} is not available`);
      }
      dependencies.updateAgentModel(projectId, agentId, model || undefined);
    } else if (
      typeof data.title === "string"
      && typeof data.description === "string"
      && typeof data.prompt === "string"
    ) {
      dependencies.updateAgentConfiguration(projectId, agentId, {
        title: data.title,
        description: data.description,
        prompt: data.prompt,
        model: typeof data.model === "string" ? data.model : undefined,
      }, await dependencies.getModelCatalog());
    } else if (typeof data.prompt === "string") dependencies.updateAgentPrompt(projectId, agentId, data.prompt);
    else dependencies.updateAgentDetails(projectId, agentId, data.title || "", data.description || "");
    const revision = dependencies.getRevision?.(projectId);
    return Response.json({ ok: true, revision }, revision === undefined ? undefined : { headers: { ETag: `"${revision}"` } });
  } catch (error) {
    return agentErrorResponse(error, "Agent save failed");
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  try {
    return Response.json(previewAgentDeletion(projectId, agentId));
  } catch (error) {
    return agentErrorResponse(error, "Agent deletion preview failed");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  try {
    return handleAgentDelete(projectId, agentId, expectedRevision(request), expectedIdempotencyKey(request));
  } catch (error) {
    return agentErrorResponse(error, "Agent deletion failed");
  }
}

export function handleAgentDelete(
  projectId: string,
  agentId: string,
  expected: number,
  idempotencyKey: string,
  dependencies: AgentDeleteDependencies = {
    deleteAgent: (id, agent, options) => deleteAgent(id, agent, options),
    restartProject,
    completeOperation: completeAgentDeletionOperation,
  },
) {
  let operation: AgentDeletionOperation;
  try {
    operation = dependencies.deleteAgent(projectId, agentId, { expectedRevision: expected, idempotencyKey });
  } catch (error) {
    return agentErrorResponse(error, "Agent deletion failed");
  }
  if (operation.state === "completed") {
    return Response.json({ ok: true, revision: operation.revision, operationId: operation.id }, { headers: { ETag: `"${operation.revision}"` } });
  }
  try {
    dependencies.restartProject(projectId);
    operation = dependencies.completeOperation(projectId, operation.id);
    return Response.json({ ok: true, revision: operation.revision, operationId: operation.id }, { headers: { ETag: `"${operation.revision}"` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime cleanup failed";
    try { operation = dependencies.completeOperation(projectId, operation.id, message); } catch {}
    return Response.json({
      error: "Source deleted; runtime cleanup needs attention",
      code: "cleanup_attention",
      operationId: operation.id,
      revision: operation.revision,
      detail: message,
    }, { status: 202, headers: { ETag: `"${operation.revision}"` } });
  }
}

export function scheduleAgentDeletionRestart(
  projectId: string,
  dependencies: AgentDeletionRestartDependencies = {
    restartProject,
    schedule: setImmediate,
    logError: console.error,
  },
) {
  dependencies.schedule(() => {
    try {
      dependencies.restartProject(projectId);
    } catch (error) {
      dependencies.logError(`Could not restart project "${projectId}" after agent deletion`, error);
    }
  });
}

function expectedRevision(request: Request) {
  const header = request.headers.get("if-match");
  if (!header) throw Object.assign(new Error("An If-Match configuration revision is required."), { status: 428, code: "revision_required" });
  const value = Number(header.replace(/^W\//, "").replaceAll("\"", ""));
  if (!Number.isInteger(value) || value < 0) throw new Error("Invalid If-Match configuration revision.");
  return value;
}

function expectedIdempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) throw Object.assign(new Error("An Idempotency-Key is required."), { status: 428, code: "idempotency_key_required" });
  return key;
}

function agentErrorResponse(error: unknown, fallback: string) {
  const status = error instanceof AgentRevisionConflictError
    ? 409
    : error instanceof ManagedBySourceAgentError
      ? 409
      : typeof error === "object" && error && "status" in error && typeof error.status === "number"
        ? error.status
        : 400;
  return Response.json({
    error: error instanceof Error ? error.message : fallback,
    ...(error instanceof ManagedBySourceAgentError ? { code: "managed_by_source", sourceAgentId: error.sourceAgentId } : {}),
    ...(error instanceof AgentRevisionConflictError ? { code: "stale_revision", latestRevision: error.latestRevision } : {}),
    ...(!(error instanceof AgentRevisionConflictError) && !(error instanceof ManagedBySourceAgentError)
      && typeof error === "object" && error && "code" in error ? { code: error.code } : {}),
  }, { status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  const copy = request.clone();
  const payload = await copy.json().catch(() => undefined) as { action?: unknown; operationId?: unknown } | undefined;
  if (payload?.action === "retry-cleanup" && typeof payload.operationId === "string") {
    try {
      restartProject(projectId);
      const operation = completeAgentDeletionOperation(projectId, payload.operationId);
      return Response.json({ ok: true, operationId: operation.id });
    } catch (error) {
      return agentErrorResponse(error, "Runtime cleanup retry failed");
    }
  }
  return handleAgentPatch(request, projectId, agentId, {
    setProjectLeader,
    pauseAgent,
    resumeAgent,
    clearAgentContext,
    assertCapability: (capability) => assertAgentCapability(projectId, agentId, capability),
    scheduleRestart: (id) => {
      setImmediate(() => {
        try { restartProject(id); } catch (error) { console.error("Could not restart project after leader change", error); }
      });
    },
  });
}
