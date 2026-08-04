import { addAgent } from "@/server/mutations";
import { restartProject } from "@/server/supervisor";
import { getModelCatalog } from "@/server/model-catalog";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return handleAgentPost(request, projectId);
}

export async function handleAgentPost(
  request: Request,
  projectId: string,
  dependencies = { addAgent, getModelCatalog, restartProject, schedule: setImmediate },
) {
  const data = await request.json() as { name?: string; description?: string; prompt?: string; model?: string };
  try {
    const catalog = data.model?.trim() ? await dependencies.getModelCatalog() : [];
    const id = dependencies.addAgent(
      projectId,
      data.name || "",
      data.description || "",
      data.prompt || "",
      data.model,
      catalog,
    );
    dependencies.schedule(() => {
      try { dependencies.restartProject(projectId); } catch (error) { console.error("Could not restart project after agent creation", error); }
    });
    return Response.json({ id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent creation failed" }, { status: 400 });
  }
}
