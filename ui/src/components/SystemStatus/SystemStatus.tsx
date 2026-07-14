"use client";

import type { HealthState } from "@/lib/types";
import styles from "./SystemStatus.module.css";

export function SystemStatus({ health, onRestart }: { health: HealthState; onRestart: (projectId: string) => Promise<void> }) {
  return (
    <div className={styles.status}>
      <header><span className={styles[health.status]} /> <strong>{health.label}</strong></header>
      {!health.issues.length ? <p>No active errors are recorded.</p> : health.issues.map((issue) => (
        <section key={`${issue.projectId}:${issue.summary}`}>
          <div><strong>{issue.projectName}</strong><span>{issue.summary}</span></div>
          <pre>{issue.transcript}</pre>
          <button onClick={() => void onRestart(issue.projectId)}>Restart agents</button>
        </section>
      ))}
      <button onClick={() => window.location.reload()}>Reload dashboard</button>
    </div>
  );
}
