import type { Activity } from "./types";

export function buildActivityFeed(activity: Activity[]) {
  return activity
    .filter((item) => !isRoutineCompletion(item))
    .toSorted((left, right) => {
      const time = Date.parse(right.completedAt) - Date.parse(left.completedAt);
      return Number.isNaN(time) || time === 0 ? right.id - left.id : time;
    });
}

export function compactActivitySummary(activity: Activity) {
  const withoutStatus = activity.summary
    .trim()
    .replace(/^(?:completed|delegated|retrying|failed)\s*:\s*/i, "")
    .replace(/[.\s]+$/, "");
  const parts = withoutStatus.split(/\s*;\s*/).filter(Boolean);
  const primary = parts[0] || "Activity update";
  const readable = /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(primary) ? primary.replaceAll("-", " ") : primary;
  const title = readable.charAt(0).toUpperCase() + readable.slice(1);
  const prefix = activity.status === "waiting"
    ? "Delegated "
    : activity.status === "failed"
      ? "Failed: "
      : activity.status === "retrying"
        ? "Retrying: "
        : "";
  return {
    title: `${prefix}${title}`,
    additional: Math.max(0, parts.length - 1),
  };
}

export function isRoutineCompletion(activity: Activity) {
  return activity.status === "completed"
    && /^completed (?:the )?(?:deliverable|work)[.!]?$/i.test(activity.summary.trim());
}
