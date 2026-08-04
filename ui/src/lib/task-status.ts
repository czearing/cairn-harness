export type TaskCanonicalStatus =
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled"
  | "unknown";

export interface TaskStatusPresentation {
  canonical: TaskCanonicalStatus;
  label: string;
  active: boolean;
  terminal: boolean;
  attention: boolean;
}

const normalizedPresentations: Record<string, TaskStatusPresentation> = {
  pending: presentation("queued", "Queued", true),
  queued: presentation("queued", "Queued", true),
  backlog: presentation("queued", "Backlog", true),
  buffered: presentation("queued", "Buffered", true),
  claimed: presentation("running", "Running", true),
  running: presentation("running", "Running", true),
  working: presentation("running", "Running", true),
  "in-progress": presentation("running", "Running", true),
  "in progress": presentation("running", "Running", true),
  waiting: presentation("waiting", "Waiting", true),
  blocked: presentation("blocked", "Blocked", false, false, true),
  deferred: presentation("paused", "Deferred", false),
  paused: presentation("paused", "Paused", false),
  failed: presentation("failed", "Failed", false, true, true),
  superseded: presentation("completed", "Recovered", false, true),
  done: presentation("completed", "Completed", false, true),
  completed: presentation("completed", "Completed", false, true),
  released: presentation("completed", "Released", false, true),
  cancelled: presentation("cancelled", "Cancelled", false, true),
  canceled: presentation("cancelled", "Cancelled", false, true),
};

export function taskStatusPresentation(status: string): TaskStatusPresentation {
  const normalized = status.trim().toLowerCase();
  return normalizedPresentations[normalized] || {
    canonical: "unknown",
    label: normalized ? `Unknown: ${status}` : "Unknown status",
    active: false,
    terminal: false,
    attention: true,
  };
}

function presentation(
  canonical: TaskCanonicalStatus,
  label: string,
  active: boolean,
  terminal = false,
  attention = false,
): TaskStatusPresentation {
  return { canonical, label, active, terminal, attention };
}
