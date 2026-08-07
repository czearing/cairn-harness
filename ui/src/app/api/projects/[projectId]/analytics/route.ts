import { getProjectRuntime } from "@/server/projects";
import { readCompletionEvents } from "@/server/completions";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  // getProject would read every registered project's database in full just to resolve one workspace path,
  // which measured 150-600ms per request. The runtime lookup reads a single config file instead.
  const project = getProjectRuntime(projectId);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  try {
    // Raw events are returned rather than a rendered series: bucketing depends on the viewer's time zone,
    // which only the browser knows. Sending pre-bucketed days would file evening work under tomorrow.
    return Response.json({
      events: readCompletionEvents(project.root),
      agents: project.agents.map((agent) => ({ id: agent.id, title: agent.title })),
    });
  } catch (error) {
    console.error(`Failed to read completion analytics for ${projectId}`, error);
    const reason = error instanceof Error ? error.message : "Analytics read failed";
    return Response.json({ error: reason }, { status: 500 });
  }
}
