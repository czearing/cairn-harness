export function activityStatusPresentation(status: string) {
  if (status === "waiting") {
    return { failed: false, label: "Delegated", kind: "delegated" as const };
  }
  if (status === "completed") {
    return { failed: false, label: "Completed", kind: "completed" as const };
  }
  if (status === "retrying") {
    return { failed: false, label: "Retrying", kind: "retrying" as const };
  }
  return { failed: true, label: "Failed", kind: "failed" as const };
}
