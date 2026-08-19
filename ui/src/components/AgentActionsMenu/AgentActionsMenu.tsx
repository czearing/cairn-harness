"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eraser, Pause, Play, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/Button/Button";
import type { Agent } from "@/lib/types";
import { isPlainClick } from "@/lib/dashboard-route";
import { OverlayPortal } from "../OverlayPortal/OverlayPortal";
import { agentDeletionBlockers, agentDeletionConsequence } from "../AgentWorkspace/deletion-messages";
import type { AgentDeletionPreview } from "../AgentWorkspace/agent-workspace-types";
import styles from "./AgentActionsMenu.module.css";

export interface AgentActionsMenuProps {
  agent: Agent;
  label: string;
  triggerClassName?: string;
  settingsHref?: string;
  onSettings?: (returnFocus: HTMLElement) => void;
  onPauseToggle?: () => Promise<void>;
  onClearContext?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onDeletionPreview?: () => Promise<AgentDeletionPreview>;
}

type Panel =
  | { kind: "menu" }
  | { kind: "clear" }
  | { kind: "delete-loading" }
  | { kind: "delete"; preview: AgentDeletionPreview };

export function AgentActionsMenu({
  agent,
  label,
  triggerClassName,
  settingsHref,
  onSettings,
  onPauseToggle,
  onClearContext,
  onDelete,
  onDeletionPreview,
}: AgentActionsMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const keyboardOpen = useRef(false);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [panel, setPanel] = useState<Panel>({ kind: "menu" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const close = useRef((restoreFocus = false) => {
    setOpen(false);
    setPanel({ kind: "menu" });
    setPending(false);
    setError("");
    keyboardOpen.current = false;
    if (restoreFocus) trigger.current?.focus();
  });

  useEffect(() => {
    if (!open || !keyboardOpen.current) return;
    menu.current?.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, [open, panel]);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = menu.current.getBoundingClientRect();
    const below = anchor.bottom + 4;
    setPosition({
      top: below + box.height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - box.height - 4),
      left: Math.min(window.innerWidth - box.width - 8, Math.max(8, anchor.right - box.width)),
    });
  }, [open, panel, error]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent
        && (menu.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node))) return;
      close.current(event instanceof KeyboardEvent);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      close.current(true);
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") || [])];
    const current = items.indexOf(document.activeElement as HTMLElement);
    items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    event.preventDefault();
  }

  async function run(request: () => Promise<unknown>, onDone: () => void) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await request();
      onDone();
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : "Action failed. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const capabilities = agent.capabilities;
  const paused = agent.status === "paused";
  const canPause = capabilities ? (paused ? capabilities.resume : capabilities.pause) : true;
  const canClear = capabilities ? capabilities.reset : true;
  const canDelete = capabilities ? capabilities.delete : true;

  return <>
    <Button
      variant="inherit"
      ref={trigger}
      className={triggerClassName || styles.trigger}
      data-agent-configure-id={agent.id}
      aria-label={`Actions for ${label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(event) => {
        if (open) {
          close.current();
          return;
        }
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 248) });
        keyboardOpen.current = event.detail === 0;
        setPanel({ kind: "menu" });
        setError("");
        setOpen(true);
      }}
    ><Settings2 size={15} aria-hidden="true" /></Button>
    {open && <OverlayPortal layer="menu">{(layerProps) => <div
      {...layerProps}
      ref={menu}
      role="menu"
      aria-label={`Actions for ${label}`}
      aria-busy={pending}
      className={styles.menu}
      style={{ ...layerProps.style, ...position }}
      onKeyDown={moveFocus}
    >
      {panel.kind === "menu" && <>
        {onPauseToggle && <Button
          variant="menu"
          role="menuitem"
          disabled={pending || !canPause}
          onClick={() => void run(onPauseToggle, () => close.current(true))}
        >{paused ? <Play size={14} /> : <Pause size={14} />}{pending ? "Working\u2026" : paused ? "Resume agent" : "Pause agent"}</Button>}
        {onClearContext && <Button
          variant="menu"
          role="menuitem"
          disabled={pending || !canClear}
          onClick={() => setPanel({ kind: "clear" })}
        ><Eraser size={14} />Clear context&#8230;</Button>}
        <div className={styles.separator} />
        {settingsHref && <Link
          role="menuitem"
          href={settingsHref}
          onClick={(event) => {
            if (isPlainClick(event)) event.preventDefault();
            onSettings?.(event.currentTarget);
            close.current();
          }}
        ><Settings2 size={14} />Agent settings</Link>}
        {onDelete && onDeletionPreview && <>
          <div className={styles.separator} />
          <Button
            variant="menu"
            role="menuitem"
            className={styles.danger}
            disabled={pending || !canDelete}
            onClick={() => {
              setPanel({ kind: "delete-loading" });
              void run(async () => {
                const preview = await onDeletionPreview();
                setPanel({ kind: "delete", preview });
              }, () => undefined);
            }}
          ><Trash2 size={14} />Delete agent&#8230;</Button>
        </>}
      </>}

      {panel.kind === "clear" && <div className={styles.panel}>
        <p className={styles.panelTitle}>Clear context for {label}?</p>
        <p className={styles.panelDetail}>
          Deletes this agent's conversation history and ends the current session, so the next run starts
          with an empty transcript and a fresh context window. Queued work it has not finished is kept.
        </p>
        <div className={styles.panelActions}>
          <Button variant="menu" role="menuitem" disabled={pending} onClick={() => setPanel({ kind: "menu" })}>Cancel</Button>
          <Button
            variant="menu"
            role="menuitem"
            aria-busy={pending}
            disabled={pending}
            onClick={() => onClearContext && void run(onClearContext, () => close.current(true))}
          >{pending ? "Clearing context\u2026" : "Clear context"}</Button>
        </div>
      </div>}

      {panel.kind === "delete-loading" && <p className={styles.loading}>Checking whether this agent can be deleted&#8230;</p>}

      {panel.kind === "delete" && <DeletePanel
        preview={panel.preview}
        label={label}
        pending={pending}
        onCancel={() => setPanel({ kind: "menu" })}
        onConfirm={() => onDelete && void run(onDelete, () => close.current())}
      />}

      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>}</OverlayPortal>}
  </>;
}

function DeletePanel({ preview, label, pending, onCancel, onConfirm }: {
  preview: AgentDeletionPreview;
  label: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const blockers = agentDeletionBlockers(preview, label);
  if (!preview.canDelete && blockers.length) {
    return <div className={styles.panel}>
      <p className={styles.panelTitle}>Can&rsquo;t delete this agent yet</p>
      <ul className={styles.blockerList}>
        {blockers.map((blocker) => <li key={blocker.title}>
          <strong>{blocker.title}</strong>
          <span>{blocker.detail}</span>
        </li>)}
      </ul>
      <div className={styles.panelActions}>
        <Button variant="menu" role="menuitem" onClick={onCancel}>Close</Button>
      </div>
    </div>;
  }
  return <div className={styles.panel}>
    <p className={styles.panelTitle}>Delete {label}?</p>
    <p className={styles.panelDetail}>{agentDeletionConsequence(preview, label)}</p>
    <div className={styles.panelActions}>
      <Button variant="menu" role="menuitem" disabled={pending} onClick={onCancel}>Cancel</Button>
      <Button
        variant="menu"
        role="menuitem"
        aria-busy={pending}
        disabled={pending}
        className={styles.danger}
        onClick={onConfirm}
      >{pending ? "Deleting\u2026" : "Delete permanently"}</Button>
    </div>
  </div>;
}
