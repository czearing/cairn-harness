import { createWorkItem } from "@/server/mutations";
import { submissionSuccess } from "@/server/task-submission";
import { cancelWorkItem, deleteWorkItem } from "@/server/work-mutations";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { body?: string };
  if (!data.body?.trim()) return Response.json({ error: "Task is required" }, { status: 400 });
  return Response.json(submissionSuccess(createWorkItem(projectId, data.body)));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { id?: string };
  if (!data.id) return Response.json({ error: "Task is required" }, { status: 400 });
  try {
    cancelWorkItem(projectId, data.id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Task cancellation failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { id?: string };
  if (!data.id) return Response.json({ error: "Task is required" }, { status: 400 });
  try {
    deleteWorkItem(projectId, data.id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Task deletion failed" }, { status: 400 });
  }
}
