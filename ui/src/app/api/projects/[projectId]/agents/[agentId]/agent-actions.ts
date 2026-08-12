export const INVALID_AGENT_ACTION = "Invalid agent action. Expected make-leader, pause, resume, clear-context, grant-delegate, or revoke-delegate.";

type AgentAction = "make-leader" | "pause" | "resume" | "clear-context" | "grant-delegate" | "revoke-delegate";

interface AgentActionDependencies {
  setProjectLeader: (projectId: string, agentId: string) => void;
  pauseAgent: (projectId: string, agentId: string) => void;
  resumeAgent: (projectId: string, agentId: string) => void;
  clearAgentContext: (projectId: string, agentId: string) => void;
  setAgentDelegate: (projectId: string, agentId: string, canDelegate: boolean) => void;
  scheduleRestart: (projectId: string) => void;
  assertCapability?: (capability: "promote" | "pause" | "resume" | "reset" | "delegate") => void;
}

export async function handleAgentPatch(
  request: Request,
  projectId: string,
  agentId: string,
  dependencies: AgentActionDependencies,
) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalidActionResponse();
  }
  const action = parseAgentAction(payload);
  if (!action) return invalidActionResponse();

  try {
    if (action === "make-leader") {
      dependencies.assertCapability?.("promote");
      dependencies.setProjectLeader(projectId, agentId);
      dependencies.scheduleRestart(projectId);
    } else if (action === "pause") {
      dependencies.assertCapability?.("pause");
      dependencies.pauseAgent(projectId, agentId);
    } else if (action === "resume") {
      dependencies.assertCapability?.("resume");
      dependencies.resumeAgent(projectId, agentId);
    } else if (action === "grant-delegate") {
      dependencies.assertCapability?.("delegate");
      dependencies.setAgentDelegate(projectId, agentId, true);
      dependencies.scheduleRestart(projectId);
    } else if (action === "revoke-delegate") {
      dependencies.assertCapability?.("delegate");
      dependencies.setAgentDelegate(projectId, agentId, false);
      dependencies.scheduleRestart(projectId);
    } else {
      dependencies.assertCapability?.("reset");
      dependencies.clearAgentContext(projectId, agentId);
    }
    return Response.json({ ok: true });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number"
      ? error.status
      : 400;
    const code = typeof error === "object" && error && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
    return Response.json({
      error: error instanceof Error ? error.message : "Context reset failed",
      ...(code ? { code } : {}),
    }, { status });
  }
}

function parseAgentAction(payload: unknown): AgentAction | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const action = (payload as { action?: unknown }).action;
  return action === "make-leader" || action === "pause" || action === "resume" || action === "clear-context"
    || action === "grant-delegate" || action === "revoke-delegate"
    ? action
    : undefined;
}

function invalidActionResponse() {
  return Response.json({ error: INVALID_AGENT_ACTION }, { status: 400 });
}
