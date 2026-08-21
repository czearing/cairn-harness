import styles from "./StatusIndicator.module.css";

export type StatusKind =
  | "active" | "attention" | "blocked" | "budget-exhausted" | "cancelled"
  | "completed" | "delegated" | "delivered" | "failed"
  | "healthy" | "idle" | "paused" | "queued" | "replied" | "retrying"
  | "running" | "saved" | "saving" | "sending" | "unknown" | "unsaved"
  | "waiting" | "working";

interface Presentation {
  label: string;
  tone: "positive" | "active" | "info" | "warning" | "danger" | "neutral";
  motion?: "pulse";
}

const presentations: Record<StatusKind, Presentation> = {
  active: state("Active", "active", "pulse"),
  attention: state("Needs attention", "warning"),
  blocked: state("Blocked", "danger"),
  "budget-exhausted": state("Budget exhausted", "danger"),
  cancelled: state("Cancelled", "neutral"),
  completed: state("Completed", "positive"),
  delegated: state("Delegated", "info"),
  delivered: state("Delivered", "positive"),
  failed: state("Failed", "danger"),
  healthy: state("Operational", "positive"),
  idle: state("Idle", "neutral"),
  paused: state("Paused", "warning"),
  queued: state("Queued", "info"),
  replied: state("Replied", "positive"),
  retrying: state("Retrying", "info", "pulse"),
  running: state("Running", "active", "pulse"),
  saved: state("Saved", "positive"),
  saving: state("Saving", "active", "pulse"),
  sending: state("Sending", "active", "pulse"),
  unknown: state("Unknown", "danger"),
  unsaved: state("Unsaved", "neutral"),
  waiting: state("Waiting", "info"),
  working: state("Working", "active", "pulse"),
};

interface Props {
  status: StatusKind;
  label?: string;
  size?: "compact" | "default";
  display?: "badge" | "dot";
  announce?: boolean;
  className?: string;
}

export function StatusIndicator({
  status,
  label,
  size = "default",
  display = "badge",
  announce = false,
  className = "",
}: Props) {
  const presentation = presentations[status];
  const visibleLabel = label || presentation.label;
  return <span
    className={`${styles.status} ${className}`}
    data-status={status}
    data-tone={presentation.tone}
    data-size={size}
    data-display={display}
    data-motion={presentation.motion}
    role={announce ? "status" : undefined}
    aria-live={announce ? "polite" : undefined}
    aria-label={display === "dot" ? visibleLabel : undefined}
  >
    <span className={styles.signal} aria-hidden="true" />
    {display === "badge" && <span className={styles.label}>{visibleLabel}</span>}
  </span>;
}

function state(
  label: string,
  tone: Presentation["tone"],
  motion?: Presentation["motion"],
): Presentation {
  return { label, tone, motion };
}
