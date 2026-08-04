import type { HealthState, ModelSettings, Project, QueueItem } from "@/lib/types";

export const healthy: HealthState = { status: "healthy", label: "Checking system status", issues: [] };

export function newDraft(): QueueItem {
  return { id: crypto.randomUUID(), title: "Untitled draft", meta: "", status: "draft", content: "" };
}

export async function browseWorkspace(initial: string) {
  const response = await fetch("/api/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initial }),
  });
  const data = await response.json() as { path?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "Folder selection failed");
  return data.path;
}

export async function fetchJson<T>(url: string, fallbackError: string, isValid: (value: unknown) => value is T): Promise<T> {
  const response = await fetch(url);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(fallbackError);
  }
  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === "string" ? data.error : fallbackError;
    throw new Error(message);
  }
  if (!isValid(data)) throw new Error(fallbackError);
  return data;
}

export function isProjectList(value: unknown): value is Project[] {
  return Array.isArray(value) && value.every((project) => isRecord(project)
    && typeof project.id === "string"
    && typeof project.name === "string"
    && typeof project.root === "string"
    && Array.isArray(project.agents)
    && Array.isArray(project.workItems)
    && Array.isArray(project.delegatedActions)
    && Array.isArray(project.activity)
    && typeof project.releases === "number");
}

export function isHealthState(value: unknown): value is HealthState {
  return isRecord(value)
    && (value.status === "healthy" || value.status === "paused" || value.status === "attention")
    && typeof value.label === "string"
    && Array.isArray(value.issues)
    && value.issues.every((issue) => isRecord(issue)
      && typeof issue.projectId === "string"
      && typeof issue.projectName === "string"
      && typeof issue.summary === "string"
      && typeof issue.transcript === "string");
}

export function isModelSettings(value: unknown): value is ModelSettings {
  return isRecord(value)
    && typeof value.defaultModel === "string"
    && Array.isArray(value.models)
    && value.models.every((model) => isRecord(model) && typeof model.id === "string" && typeof model.name === "string")
    && isRecord(value.catalog)
    && (
      value.catalog.status === "ready"
      || (
        value.catalog.status === "error"
        && typeof value.catalog.code === "string"
        && typeof value.catalog.message === "string"
        && (value.catalog.detail === undefined || typeof value.catalog.detail === "string")
      )
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
