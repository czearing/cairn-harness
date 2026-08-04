export const INVALID_AGENT_ACTION = "Invalid agent action. Expected make-leader, pause, resume, or clear-context.";

type AgentAction = "make-leader" | "pause" | "resume" | "clear-context";

interface AgentActionDependencies {
  setProjectLeader: (projectId: string, agentId: string) => void;
  pauseAgent: (projectId: string, agentId: string) => void;
  resumeAgent: (projectId: string, agentId: string) => void;
  clearAgentContext: (projectId: string, agentId: string) => void;
  scheduleRestart: (projectId: string) => void;
  assertCapability?: (capability: "promote" | "pause" | "resume" | "reset") => void;
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
    ? action
    : undefined;
}

function invalidActionResponse() {
  return Response.json({ error: INVALID_AGENT_ACTION }, { status: 400 });
}
