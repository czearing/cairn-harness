export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build") return;
  const [{ startAllProjects }, { supervisorReconcileIntervalMs }, { maybeCheckForHarnessUpdate, autoUpdateIntervalMs }] = await Promise.all([
    import("@/server/supervisor"),
    import("@/server/supervisor-policy"),
    import("@/server/harness-update"),
  ]);
  startAllProjects();
  const reconciliation = setInterval(startAllProjects, supervisorReconcileIntervalMs());
  reconciliation.unref();

  // Keeps this machine's harness current with origin/master with no human running git pull +
  // cargo build + restart by hand: see harness-update.ts for the fast-forward-only policy and
  // the stop-all/build/restart-all sequence that frees the locked release binary on Windows.
  const updateCheck = setInterval(() => {
    maybeCheckForHarnessUpdate()
      .then((result) => {
        if (result && result.status !== "current") {
          console.log(`[harness-update] ${result.status}: ${result.reason} (${result.from.slice(0, 7)} -> ${result.to.slice(0, 7)})`);
        }
      })
      .catch((error) => console.error("[harness-update] check failed", error));
  }, Math.min(autoUpdateIntervalMs(), 60_000));
  updateCheck.unref();
}
