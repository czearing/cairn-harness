export type ProjectSettingsSection = "appearance" | "workflow" | "ideas";

export type DashboardRoute =
  | { kind: "root" }
  | { kind: "new-project" }
  | { kind: "settings" }
  | { kind: "system" }
  | { kind: "project"; projectId: string; view: "overview" | "activity" }
  | { kind: "draft"; projectId: string; draftId: string }
  | { kind: "new-agent"; projectId: string }
  | { kind: "conversation"; projectId: string; agentId: string; focusId?: string }
  | { kind: "agent-settings"; projectId: string; agentId: string }
  | { kind: "project-settings"; projectId: string; section: ProjectSettingsSection };

export function parseDashboardPath(pathname: string): DashboardRoute | undefined {
  return parseDashboardSegments(pathname.split("/").filter(Boolean).map(decodeSegment));
}

export function parseDashboardSegments(segments: string[]): DashboardRoute | undefined {
  if (segments.length === 0) return { kind: "root" };
  if (segments.length === 1 && segments[0] === "settings") return { kind: "settings" };
  if (segments.length === 1 && segments[0] === "system") return { kind: "system" };
  if (segments.length === 2 && segments[0] === "projects" && segments[1] === "new") return { kind: "new-project" };
  if (segments[0] !== "projects" || !segments[1]) return undefined;
  const projectId = segments[1];
  if (segments.length === 2) return { kind: "project", projectId, view: "overview" };
  if (segments.length === 3 && segments[2] === "activity") return { kind: "project", projectId, view: "activity" };
  if (segments.length === 4 && segments[2] === "drafts") return { kind: "draft", projectId, draftId: segments[3] };
  if (segments.length === 4 && segments[2] === "agents" && segments[3] === "new") return { kind: "new-agent", projectId };
  if (segments.length >= 4 && segments[2] === "agents") {
    const agentId = segments[3];
    if (segments.length === 4) return { kind: "conversation", projectId, agentId };
    if (segments.length === 5 && segments[4] === "settings") return { kind: "agent-settings", projectId, agentId };
    if (segments.length === 6 && segments[4] === "messages") {
      return { kind: "conversation", projectId, agentId, focusId: segments[5] };
    }
  }
  if (segments.length === 4 && segments[2] === "settings" && isProjectSettingsSection(segments[3])) {
    return { kind: "project-settings", projectId, section: segments[3] };
  }
  return undefined;
}

export function dashboardHref(route: Exclude<DashboardRoute, { kind: "root" }>) {
  switch (route.kind) {
    case "new-project": return "/projects/new";
    case "settings": return "/settings";
    case "system": return "/system";
    case "project": return `/projects/${encodeSegment(route.projectId)}${route.view === "activity" ? "/activity" : ""}`;
    case "draft": return `/projects/${encodeSegment(route.projectId)}/drafts/${encodeSegment(route.draftId)}`;
    case "new-agent": return `/projects/${encodeSegment(route.projectId)}/agents/new`;
    case "conversation": {
      const base = `/projects/${encodeSegment(route.projectId)}/agents/${encodeSegment(route.agentId)}`;
      return route.focusId ? `${base}/messages/${encodeSegment(route.focusId)}` : base;
    }
    case "agent-settings":
      return `/projects/${encodeSegment(route.projectId)}/agents/${encodeSegment(route.agentId)}/settings`;
    case "project-settings":
      return `/projects/${encodeSegment(route.projectId)}/settings/${route.section}`;
  }
}

export function projectIdForRoute(route?: DashboardRoute) {
  return route && "projectId" in route ? route.projectId : undefined;
}

function isProjectSettingsSection(value: string): value is ProjectSettingsSection {
  return value === "appearance" || value === "workflow" || value === "ideas";
}

function encodeSegment(value: string) {
  return encodeURIComponent(value);
}

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
