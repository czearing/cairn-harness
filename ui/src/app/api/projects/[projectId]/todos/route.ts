import { deleteTodo } from "@/server/work-mutations";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { path?: string };
  if (!data.path) return Response.json({ error: "Delegated action is required" }, { status: 400 });
  try {
    deleteTodo(projectId, data.path);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Delegated action deletion failed" }, { status: 400 });
  }
}
