import { getProjects } from "@/server/projects";
import { createProject } from "@/server/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getProjects());
}

export async function POST(request: Request) {
  const data = await request.json() as { name?: string; roles?: string };
  try {
    const id = createProject(data.name || "", data.roles || "");
    return Response.json({ id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Project creation failed" }, { status: 400 });
  }
}
