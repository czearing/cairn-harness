export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build") return;
  const [{ startAllProjects }, { supervisorReconcileIntervalMs }] = await Promise.all([
    import("@/server/supervisor"),
    import("@/server/supervisor-policy"),
  ]);
  startAllProjects();
  const reconciliation = setInterval(startAllProjects, supervisorReconcileIntervalMs());
  reconciliation.unref();
}
