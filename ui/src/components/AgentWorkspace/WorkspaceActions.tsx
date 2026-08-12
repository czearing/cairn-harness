"use client";

import { Button } from "@/components/Button/Button";

import { useRef, useState } from "react";
import type { Agent } from "@/lib/types";
import type { AgentDeletionPreview } from "./agent-workspace-types";
import { agentDeletionBlockers, agentDeletionConsequence } from "./deletion-messages";
import styles from "./AgentWorkspace.module.css";

type Action = "leader" | "pause" | "reset" | "delete" | "delegate";

export function AgentRuntimeActions({
  agent,
  disabled,
  onMakeLeader,
  onPauseToggle,
  onReset,
  onDelete,
  onDeletionPreview,
  onDelegateToggle,
}: {
  agent: Agent;
  disabled?: boolean;
  onMakeLeader?: () => Promise<void>;
  onPauseToggle: () => Promise<void>;
  onReset: () => Promise<void>;
  onDelete: () => Promise<void>;
  onDeletionPreview: () => Promise<AgentDeletionPreview>;
  onDelegateToggle?: () => Promise<void>;
}) {
  const active = useRef<Action | undefined>(undefined);
  const [pending, setPending] = useState<Action>();
  const [confirm, setConfirm] = useState<Action>();
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<AgentDeletionPreview>();
  const [previewError, setPreviewError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const agentLabel = agent.title || agent.id;
  const deletable = agent.capabilities?.delete !== false;

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

  function dismissDelete() {
    setConfirm(undefined);
    setPreview(undefined);
    setPreviewError("");
    setError("");
  }

  async function startDelete() {
    setConfirm("delete");
    setError("");
    setPreviewError("");
    setPreview(undefined);
    setLoadingPreview(true);
    try {
      setPreview(await onDeletionPreview());
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "Could not check whether this agent can be deleted.");
    } finally {
      setLoadingPreview(false);
    }
  }

  const blockers = preview ? agentDeletionBlockers(preview, agentLabel) : [];
  const blocked = Boolean(preview && !preview.canDelete);

  return <section className={styles.runtimeActions} aria-label="Agent controls">
    <div className={styles.runtimeBody}>
      <div className={styles.actionRow}>
        {!agent.isLeader && onMakeLeader && <Button variant="secondary" type="button" disabled={disabled || Boolean(pending)} onClick={() => void run("leader", onMakeLeader)}>
          {pending === "leader" ? "Making project lead" : "Make project lead"}
        </Button>}
        {!agent.isLeader && agent.capabilities?.delegate !== false && onDelegateToggle && <Button variant="secondary" type="button" disabled={disabled || Boolean(pending)} onClick={() => void run("delegate", onDelegateToggle)}>
          {pending === "delegate" ? "Updating delegation" : agent.isDelegate ? "Revoke delegation" : "Grant delegation"}
        </Button>}
        <Button variant="secondary" type="button" disabled={disabled || Boolean(pending)} onClick={() => void run("pause", onPauseToggle)}>
          {pending === "pause" ? "Updating status" : agent.status === "paused" ? "Resume agent" : "Pause agent"}
        </Button>
        <Button variant="secondary" type="button" disabled={disabled || Boolean(pending)} onClick={() => confirm === "reset"
          ? void run("reset", onReset)
          : setConfirm("reset")}>
          {pending === "reset" ? "Clearing context" : confirm === "reset" ? "Confirm clear context" : "Clear context"}
        </Button>
        {confirm === "reset" && <p className={styles.deleteDetail}>
          Deletes this agent&apos;s conversation history and ends the current session, so the next run starts
          with an empty transcript and a fresh context window. Queued work it has not finished is kept.
        </p>}
        {confirm === "reset" && <Button variant="ghost" type="button" disabled={Boolean(pending)} onClick={() => setConfirm(undefined)}>Cancel</Button>}
        {deletable && confirm !== "delete" && <Button
          variant="danger"
          className={styles.dangerButton}
          type="button"
          disabled={disabled || Boolean(pending)}
          onClick={() => void startDelete()}
        >Delete agent</Button>}
      </div>

      {deletable && confirm === "delete" && <div className={styles.deletePanel} role="group" aria-label={`Delete ${agentLabel}`}>
        <h3 className={styles.deleteTitle}>Delete {agentLabel}?</h3>
        {loadingPreview && <p className={styles.deleteDetail}>Checking whether this agent can be deleted&hellip;</p>}
        {previewError && <p className={styles.error} role="alert">{previewError}</p>}

        {preview && blocked && <>
          <p className={styles.deleteDetail}>This agent can&apos;t be deleted yet:</p>
          <ul className={styles.blockerList}>
            {blockers.map((blocker) => <li key={blocker.title}>
              <strong>{blocker.title}</strong> {blocker.detail}
            </li>)}
          </ul>
        </>}

        {preview && !blocked && <p className={styles.deleteDetail}>{agentDeletionConsequence(preview, agentLabel)}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actionRow}>
          {preview && !blocked && <Button
            variant="danger"
            className={styles.dangerButton}
            type="button"
            disabled={Boolean(pending)}
            onClick={() => void run("delete", onDelete)}
          >{pending === "delete" ? "Deleting agent" : "Delete permanently"}</Button>}
          <Button variant="secondary" type="button" disabled={Boolean(pending)} onClick={dismissDelete}>
            {blocked ? "Close" : "Cancel"}
          </Button>
        </div>
      </div>}

      {error && confirm !== "delete" && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </section>;
}
