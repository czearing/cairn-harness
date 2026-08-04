import { submitDraft } from "@/server/mutations";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { id?: string; body?: string };
  if (!data.id) return Response.json({ error: "Draft id is required" }, { status: 400 });
  if (!data.body?.trim()) return Response.json({ error: "Task is required" }, { status: 400 });
  return Response.json({ ok: true, ...submitDraft(projectId, data.id, data.body) });
}
