import { updateAutomation } from "@/server/automation-mutations";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return handleAutomationPut(request, projectId);
}

export async function handleAutomationPut(
  request: Request,
  projectId: string,
  update: typeof updateAutomation = updateAutomation,
) {
  try {
    const data = await request.json() as {
      maxActiveTasks?: number;
      ideaAgents: { agentId: string; taskLimit: number; prompt: string }[];
    };
    const result = await update(projectId, data);
    if (result.restartError) {
      return Response.json({ error: result.restartError, persisted: true }, { status: 503 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Automation update failed" }, { status: 400 });
  }
}
