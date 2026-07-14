import { saveDocument } from "@/server/mutations";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { path?: string; body?: string };
  if (!data.path) return Response.json({ error: "Document path is required" }, { status: 400 });
  try {
    saveDocument(projectId, data.path, data.body || "");
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Document save failed" }, { status: 400 });
  }
}
