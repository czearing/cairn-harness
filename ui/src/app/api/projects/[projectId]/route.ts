import { readFileSync } from "node:fs";
import { deleteProject, pauseProject, resumeProject } from "@/server/supervisor";
import { getProjectConfigPath } from "@/server/projects";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { paused?: boolean };
  try {
    if (data.paused) pauseProject(projectId);
    else resumeProject(projectId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Project update failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { confirmation?: string };
  try {
    const configPath = getProjectConfigPath(projectId);
    if (!configPath) return Response.json({ error: "Project not found" }, { status: 404 });
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { name?: unknown };
    if (data.confirmation !== projectId && data.confirmation !== config.name) {
      return Response.json({ error: "Project confirmation did not match" }, { status: 400 });
    }
    deleteProject(projectId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Project removal failed" }, { status: 400 });
  }
}
