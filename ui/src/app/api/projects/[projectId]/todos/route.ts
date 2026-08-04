import { cancelWorkItem } from "@/server/work-mutations";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { path?: string };
  const id = data.path?.replace(/^task:/, "");
  if (!id) return Response.json({ error: "Delegated action is required" }, { status: 400 });
  try {
    cancelWorkItem(projectId, id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Cancellation failed" }, { status: 400 });
  }
}
