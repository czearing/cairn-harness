"use client";

import { Button } from "@/components/Button/Button";

import { useRef, useState } from "react";
import type { HealthState } from "@/lib/types";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import styles from "./SystemStatus.module.css";

export function SystemStatus({ health, onRestart }: { health: HealthState; onRestart: (projectId: string) => Promise<void> }) {
  const restarting = useRef(new Set<string>());
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function restart(projectId: string) {
    if (restarting.current.has(projectId)) return;
    restarting.current.add(projectId);
    setPending((current) => ({ ...current, [projectId]: true }));
    setErrors((current) => {
      if (!current[projectId]) return current;
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    try {
      await onRestart(projectId);
    } catch (cause) {
      const message = cause instanceof Error && cause.message
        ? `Could not restart agents. ${cause.message}`
        : "Could not restart agents.";
      setErrors((current) => ({ ...current, [projectId]: message }));
    } finally {
      restarting.current.delete(projectId);
      setPending((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
    }
  }

  return (
    <div className={styles.status}>
      <header><StatusIndicator status={health.status} label={health.label} announce /></header>
      {!health.issues.length ? <p>No active errors are recorded.</p> : health.issues.map((issue, index) => {
        const error = errors[issue.projectId];
        const errorId = `restart-agents-error-${issue.projectId}`;
        const showError = error && health.issues.findIndex((candidate) => candidate.projectId === issue.projectId) === index;
        return (
          <section key={`${issue.projectId}:${issue.summary}`}>
            <div><strong>{issue.projectName}</strong><span>{issue.summary}</span></div>
            <pre>{issue.transcript}</pre>
            <Button variant="secondary" disabled={pending[issue.projectId]} aria-describedby={error ? errorId : undefined} onClick={() => void restart(issue.projectId)}>
              {pending[issue.projectId] ? "Restarting agents" : "Restart agents"}
            </Button>
            {showError && <p id={errorId} role="alert">{error}</p>}
          </section>
        );
      })}
      <Button variant="secondary" onClick={() => window.location.reload()}>Reload dashboard</Button>
    </div>
  );
}
