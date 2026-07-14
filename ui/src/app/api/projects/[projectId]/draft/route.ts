import { deleteDraft, saveDraft } from "@/server/mutations";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { id?: string; body?: string };
  if (!data.id) return Response.json({ error: "Draft id is required" }, { status: 400 });
  saveDraft(projectId, data.id, data.body || "");
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const id = new URL(_request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Draft id is required" }, { status: 400 });
  deleteDraft(projectId, id);
  return Response.json({ ok: true });
}
