import { Dashboard } from "@/components/Dashboard/Dashboard";
import { DASHBOARD_LAYOUT_COOKIE_KEY } from "@/components/Dashboard/dashboard-layout";
import { DRAFT_HEIGHTS_COOKIE_KEY, parseDraftHeights } from "@/components/Dashboard/draft-workspace-storage";
import { dashboardHref, parseDashboardSegments, projectIdForRoute } from "@/lib/dashboard-route";
import { SELECTED_PROJECT_KEY } from "@/lib/selected-project";
import { getProjects } from "@/server/projects";
import { workspaceRoot } from "@/server/workspace-root";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ route: string[] }> }) {
  const segments = (await params).route;
  const route = parseDashboardSegments(segments);
  if (!route || route.kind === "root") notFound();

  const initialProjects = getProjects();
  const cookieStore = await cookies();
  const cookieProject = cookieStore.get(SELECTED_PROJECT_KEY)?.value;
  const fallbackProject = initialProjects.some((project) => project.id === cookieProject)
    ? cookieProject
    : initialProjects[0]?.id;
  const routeProjectId = projectIdForRoute(route);
  const routeProject = routeProjectId
    ? initialProjects.find((project) => project.id === routeProjectId)
    : undefined;
  if (routeProjectId && !routeProject) notFound();
  if (
    routeProject
    && (route.kind === "conversation" || route.kind === "agent-settings")
    && !routeProject.agents.some((agent) => agent.id === route.agentId)
  ) notFound();

  const selectedProject = routeProjectId || fallbackProject;
  const initialDashboardLayout = decodeCookie(cookieStore.get(DASHBOARD_LAYOUT_COOKIE_KEY)?.value);
  const initialDraftHeight = selectedProject
    ? parseDraftHeights(decodeCookie(cookieStore.get(DRAFT_HEIGHTS_COOKIE_KEY)?.value))[selectedProject]
    : undefined;
  return <Dashboard
    initialProjects={initialProjects}
    initialSelectedProject={selectedProject}
    initialDashboardLayout={initialDashboardLayout}
    initialDraftHeight={initialDraftHeight}
    initialPathname={dashboardHref(route)}
    workspaceRoot={workspaceRoot()}
  />;
}

function decodeCookie(value?: string) {
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}
