import type { Project } from "@/lib/types";
import type { DraftWorkspaceState } from "./DraftWorkspaceView";

export const DRAFT_WORKSPACE_STORAGE_KEY = "harness-draft-workspaces";
export const DRAFT_HEIGHTS_COOKIE_KEY = "harness-draft-heights";

export function restoreDraftWorkspace(project: Project, snapshot?: string, fallbackHeight?: number): DraftWorkspaceState {
  const identity = parseIdentity(snapshot);
  const drafts = new Map((project.drafts || []).map((item) => [item.id, item]));
  const restored = identity.openIds.flatMap((id) => {
    const item = drafts.get(id);
    return item ? [{ item, persisted: true }] : [];
  });
  const restoredIds = new Set(restored.map((tab) => tab.item.id));
  const tabs = [
    ...restored,
    ...(project.drafts || [])
      .filter((item) => !restoredIds.has(item.id))
      .map((item) => ({ item, persisted: true })),
  ];
  return {
    tabs,
    activeId: tabs.some((tab) => tab.item.id === identity.activeId)
      ? identity.activeId
      : tabs.at(-1)?.item.id,
    height: identity.height ?? fallbackHeight,
  };
}

export function parseDraftHeights(value?: string) {
  if (!value) return {} as Record<string, number>;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
  } catch {
    return {} as Record<string, number>;
  }
}

function parseIdentity(raw?: string): { openIds: string[]; activeId?: string; height?: number } {
  if (!raw) return { openIds: [] };
  try {
    const value = JSON.parse(raw) as { openIds?: unknown; activeId?: unknown; height?: unknown };
    return {
      openIds: Array.isArray(value.openIds) ? value.openIds.filter((id): id is string => typeof id === "string") : [],
      activeId: typeof value.activeId === "string" ? value.activeId : undefined,
      height: typeof value.height === "number" ? value.height : undefined,
    };
  } catch {
    return { openIds: [] };
  }
}
