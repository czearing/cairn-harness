import type { Project } from "@/lib/types";

export function isRelevantProjectEvent(file: string, workDir?: string) {
  const normalized = file.replaceAll("\\", "/");
  return normalized === "project.json"
    || normalized.startsWith(`${workDir || "work-items"}/`)
    || normalized.startsWith("todos/")
    || normalized.startsWith(".cairn-harness/live-responses/")
    || Boolean(sessionEventMatch(normalized))
    || isDatabase(normalized);
}

export function projectEventAgent(file: string, project: Project) {
  const normalized = file.replaceAll("\\", "/");
  const match = /^\.cairn-harness\/live-responses\/(.+)\.json$/.exec(normalized)
    || sessionEventMatch(normalized);
  const agent = match?.[1];
  return agent && project.agents.some((candidate) => candidate.id === agent) ? agent : undefined;
}

export function isDatabase(file: string) {
  return file === ".cairn-harness/harness.db" || file === ".cairn-harness/harness.db-wal";
}

function sessionEventMatch(file: string) {
  return /^\.cairn-harness\/copilot-home\/([^/]+)\/session-state\/[^/]+\/events\.jsonl$/.exec(file);
}
