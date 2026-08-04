import { InvalidMessageRecipientError, sendMessage } from "@/server/mutations";
import { getConversation } from "@/server/projects";
import { submissionSuccess, TaskSubmissionConflictError } from "@/server/task-submission";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const agent = query.get("agent") || "";
  const limit = Math.min(20_000, Math.max(20, Number(query.get("limit")) || 30));
  if (!agent) return Response.json({ error: "Agent is required" }, { status: 400 });
  const page = getConversation(projectId, agent, query.get("before") || undefined, query.get("focus") || undefined, limit);
  return page ? Response.json(page) : Response.json({ error: "Project or agent not found" }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { agent?: string; body?: string; submissionId?: string };
  if (!data.agent?.trim() || !data.body?.trim()) return Response.json({ error: "Agent and message are required" }, { status: 400 });
  try {
    return Response.json(submissionSuccess(sendMessage(projectId, data.agent, data.body, data.submissionId), true));
  } catch (error) {
    if (error instanceof InvalidMessageRecipientError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof TaskSubmissionConflictError) return Response.json({ error: error.message }, { status: 409 });
    console.error("Failed to send dashboard message", { projectId, agent: data.agent }, error);
    const reason = error instanceof Error && error.message ? error.message : String(error);
    return Response.json({ error: `The server could not queue this message: ${reason}` }, { status: 500 });
  }
}
