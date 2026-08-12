import { getProjectRuntime } from "@/server/projects";
import { dashboardTaskId, readTaskRows } from "@/server/task-rows";

export const runtime = "nodejs";

const maxIds = 200;

/**
 * Report the exact status of tasks the caller already submitted.
 *
 * Accepts either full task ids (`id=`) or the submission ids the caller minted
 * (`submissionId=`), since a submitter holds the latter and the mapping between the two
 * belongs to the harness rather than to every client that would otherwise guess it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const submissionIds = query.getAll("submissionId").filter((value) => value.length > 0);
  const ids = [...query.getAll("id").filter((value) => value.length > 0), ...submissionIds.map(dashboardTaskId)];
  if (ids.length === 0) return Response.json({ error: "At least one id or submissionId is required" }, { status: 400 });
  if (ids.length > maxIds) return Response.json({ error: `At most ${maxIds} ids may be requested` }, { status: 400 });
  const project = getProjectRuntime(projectId);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  try {
    return Response.json({ tasks: readTaskRows(project.root, [...new Set(ids)]) });
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : String(error);
    return Response.json({ error: `The server could not read task status: ${reason}` }, { status: 500 });
  }
}
