import { sendMessage } from "@/server/projects";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { agent?: string; body?: string };
  if (!data.agent?.trim() || !data.body?.trim()) return Response.json({ error: "Agent and message are required" }, { status: 400 });
  sendMessage(projectId, data.agent, data.body);
  return Response.json({ ok: true });
}
