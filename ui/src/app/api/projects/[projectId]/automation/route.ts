import { updateAutomation } from "@/server/automation-mutations";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { producer?: string; limit?: number };
  try {
    updateAutomation(projectId, data.producer, data.limit);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Automation update failed" }, { status: 400 });
  }
}
