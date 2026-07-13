import { createWorkItem } from "@/server/projects";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { body?: string };
  if (!data.body?.trim()) return Response.json({ error: "Work item is required" }, { status: 400 });
  createWorkItem(projectId, data.body);
  return Response.json({ ok: true });
}
