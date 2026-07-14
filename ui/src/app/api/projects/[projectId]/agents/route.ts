import { addAgent } from "@/server/mutations";
import { restartProject } from "@/server/supervisor";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { name?: string; description?: string; prompt?: string };
  try {
    const id = addAgent(projectId, data.name || "", data.description || "", data.prompt || "");
    setImmediate(() => {
      try { restartProject(projectId); } catch (error) { console.error("Could not restart project after agent creation", error); }
    });
    return Response.json({ id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent creation failed" }, { status: 400 });
  }
}
