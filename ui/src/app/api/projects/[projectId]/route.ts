import { deleteProject, pauseProject, resumeProject } from "@/server/supervisor";

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
  if (data.confirmation !== projectId) return Response.json({ error: "Project confirmation did not match" }, { status: 400 });
  try {
    deleteProject(projectId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Project deletion failed" }, { status: 400 });
  }
}
