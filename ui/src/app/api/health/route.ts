import { getHealth } from "@/server/health";
import { restartProject } from "@/server/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getHealth());
}

export async function POST(request: Request) {
  const data = await request.json() as { projectId?: string };
  if (!data.projectId) return Response.json({ error: "Project is required" }, { status: 400 });
  try {
    restartProject(data.projectId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Restart failed" }, { status: 400 });
  }
}
