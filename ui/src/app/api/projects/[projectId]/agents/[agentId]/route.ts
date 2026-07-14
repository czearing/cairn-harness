import { clearAgentContext, deleteAgent, setProjectLeader, updateAgentPrompt } from "@/server/mutations";
import { restartProject } from "@/server/supervisor";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  const data = await request.json() as { prompt?: string };
  try {
    updateAgentPrompt(projectId, agentId, data.prompt || "");
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Prompt save failed" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  try {
    deleteAgent(projectId, agentId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent deletion failed" }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  const data = await request.json().catch(() => ({})) as { action?: string };
  try {
    if (data.action === "make-leader") {
      setProjectLeader(projectId, agentId);
      setImmediate(() => {
        try { restartProject(projectId); } catch (error) { console.error("Could not restart project after leader change", error); }
      });
    } else {
      clearAgentContext(projectId, agentId);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Context reset failed" }, { status: 400 });
  }
}
