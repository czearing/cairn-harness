import { addAgent } from "@/server/mutations";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await request.json() as { name?: string; description?: string; prompt?: string };
  try {
    return Response.json({ id: addAgent(projectId, data.name || "", data.description || "", data.prompt || "") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent creation failed" }, { status: 400 });
  }
}
