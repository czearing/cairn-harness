import { createHash } from "node:crypto";
import { getProjects } from "@/server/projects";
import { createProject } from "@/server/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The dashboard revalidates this list about once a second while agents are running.
 * Tagging it lets an unchanged list answer with an empty 304 instead of resending and
 * reparsing the entire payload.
 */
export function projectsResponse(readProjects: typeof getProjects = getProjects, request?: Request) {
  const body = JSON.stringify(readProjects());
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers = { "content-type": "application/json", etag, "cache-control": "no-cache" };
  if (request?.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

export async function GET(request: Request) {
  return projectsResponse(getProjects, request);
}

export async function POST(request: Request) {
  const data = await request.json() as { name?: string; workspace?: string };
  try {
    const id = createProject(data.name || "", data.workspace || "");
    return Response.json({ id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Project creation failed" }, { status: 400 });
  }
}
