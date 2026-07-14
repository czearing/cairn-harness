import { sendMessage } from "@/server/mutations";
import { getConversation } from "@/server/projects";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const agent = query.get("agent") || "";
  const limit = Math.min(100, Math.max(20, Number(query.get("limit")) || 80));
  if (!agent) return Response.json({ error: "Agent is required" }, { status: 400 });
  const page = getConversation(projectId, agent, query.get("before") || undefined, query.get("focus") || undefined, limit);
  return page ? Response.json(page) : Response.json({ error: "Project or agent not found" }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { agent?: string; body?: string };
  if (!data.agent?.trim() || !data.body?.trim()) return Response.json({ error: "Agent and message are required" }, { status: 400 });
  sendMessage(projectId, data.agent, data.body);
  return Response.json({ ok: true });
}
