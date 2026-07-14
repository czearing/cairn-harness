import { updateAgentPrompt } from "@/server/mutations";

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
