"use client";

import { Button } from "@/components/Button/Button";

import { useRef, useState } from "react";
import type { Agent } from "@/lib/types";
import styles from "./AgentWorkspace.module.css";

type Action = "leader" | "pause" | "reset" | "delete";

export function AgentRuntimeActions({
  agent,
  disabled,
  onMakeLeader,
  onPauseToggle,
  onReset,
  onDelete,
}: {
  agent: Agent;
  disabled?: boolean;
  onMakeLeader?: () => Promise<void>;
  onPauseToggle: () => Promise<void>;
  onReset: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const active = useRef<Action | undefined>(undefined);
  const [pending, setPending] = useState<Action>();
  const [confirm, setConfirm] = useState<Action>();
  const [error, setError] = useState("");
  async function run(action: Action, callback: () => Promise<void>) {
    if (active.current) return;
    active.current = action;
    setPending(action);
    setError("");
    try {
      await callback();
      setConfirm(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent action failed");
    } finally {
      active.current = undefined;
      setPending(undefined);
    }
  }
  return <section className={styles.runtimeActions} aria-label="Agent controls">
    <div className={styles.runtimeBody}>
      <div className={styles.actionRow}>
        {!agent.isLeader && onMakeLeader && <Button variant="secondary" type="button" disabled={disabled || Boolean(pending)} onClick={() => void run("leader", onMakeLeader)}>
          {pending === "leader" ? "Making project lead" : "Make project lead"}
        </Button>}
        <Button variant="secondary" type="button" disabled={disabled || Boolean(pending)} onClick={() => void run("pause", onPauseToggle)}>
          {pending === "pause" ? "Updating status" : agent.status === "paused" ? "Resume agent" : "Pause agent"}
        </Button>
        <Button variant="secondary" type="button" disabled={disabled || Boolean(pending)} onClick={() => confirm === "reset"
          ? void run("reset", onReset)
          : setConfirm("reset")}>
          {pending === "reset" ? "Restarting session" : confirm === "reset" ? "Confirm restart session" : "Restart session"}
        </Button>
        {!agent.isLeader && <Button variant="danger" className={styles.dangerButton} type="button" disabled={disabled || Boolean(pending)} onClick={() => confirm === "delete"
          ? void run("delete", onDelete)
          : setConfirm("delete")}>
          {pending === "delete" ? "Deleting agent" : confirm === "delete" ? "Confirm delete agent" : "Delete agent"}
        </Button>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </section>;
}
