export function supervisorEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.HARNESS_ENABLE_SUPERVISOR !== "0"
    && environment.HARNESS_DISABLE_SUPERVISOR !== "1";
}

export function supervisorRestartDelayMs(environment: NodeJS.ProcessEnv = process.env) {
  const configured = Number(environment.HARNESS_WORKER_RESTART_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 1_000;
}

export function supervisorReconcileIntervalMs(environment: NodeJS.ProcessEnv = process.env) {
  const configured = Number(environment.HARNESS_WORKER_RECONCILE_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 250 ? configured : 1_000;
}
