"use client";

import { Button } from "@/components/Button/Button";
import { IdentityMark } from "@/components/IdentityMark/IdentityMark";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { CirclePause, CirclePlay, Palette, Settings2, Trash2, TriangleAlert } from "lucide-react";
import type { Project } from "@/lib/types";
import { eligibleDescendants } from "@/lib/focus";
import { Modal } from "../Modal/Modal";
import { OverlayPortal } from "../OverlayPortal/OverlayPortal";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import styles from "./ProjectContextMenu.module.css";
import { projectRemovalCopy } from "./project-removal-copy";

interface Props {
  project: Project;
  x: number;
  y: number;
  anchor?: { left: number; right: number; top: number; bottom: number };
  opener?: HTMLButtonElement;
  color: string;
  avatar?: string;
  onAppearance: () => void;
  onWorkflow: () => void;
  onPause: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: (reason: "escape" | "outside" | "tab") => void;
}

type PendingMutation = "pause" | "delete";
const MENU_WIDTH = 240;

export function ProjectContextMenu({ project, x, y, anchor, opener, color, avatar, onAppearance, onWorkflow, onPause, onDelete, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const pauseButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const pendingMutation = useRef<PendingMutation | undefined>(undefined);
  const retryFocus = useRef<PendingMutation | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<PendingMutation>();
  const [error, setError] = useState("");
  const [position, setPosition] = useState(() => ({
    left: Math.max(8, anchor ? anchor.right - MENU_WIDTH : x),
    top: Math.max(8, anchor ? anchor.bottom + 4 : y),
  }));
  const closeFromEffect = useEffectEvent(onClose);
  useEffect(() => {
    if (confirming) return;
    root.current?.querySelector<HTMLElement>("[role='menuitem']:not(:disabled), input:not(:disabled)")?.focus();
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (pendingMutation.current) return;
      if (event instanceof PointerEvent && root.current?.contains(event.target as Node)) return;
      if (event instanceof PointerEvent && opener?.contains(event.target as Node)) return;
      closeFromEffect(event instanceof KeyboardEvent ? "escape" : "outside");
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [confirming, opener]);
  useEffect(() => {
    if (pending || !error) return;
    const target = retryFocus.current === "delete" ? deleteButton.current : pauseButton.current;
    retryFocus.current = undefined;
    target?.focus();
  }, [error, pending]);
  useLayoutEffect(() => {
    function updatePosition() {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const next = {
        left: Math.max(8, Math.min(anchor ? anchor.right - rect.width : x, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(anchor ? anchor.bottom + 4 : y, window.innerHeight - rect.height - 8)),
      };
      setPosition((current) => current.left === next.left && current.top === next.top ? current : next);
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [anchor, confirming, error, x, y]);
  async function runMutation(kind: PendingMutation, callback: () => Promise<void>) {
    if (pendingMutation.current) return;
    pendingMutation.current = kind;
    setError("");
    setPending(kind);
    try {
      await callback();
    } catch (cause) {
      retryFocus.current = kind;
      setError(cause instanceof Error ? cause.message : "Project action failed");
    } finally {
      pendingMutation.current = undefined;
      setPending(undefined);
    }
  }
  function moveMenuFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      const candidates = eligibleDescendants(document.body).filter((candidate) => !root.current?.contains(candidate));
      const current = opener ? candidates.indexOf(opener) : -1;
      const target = current < 0
        ? undefined
        : candidates[current + (event.shiftKey ? -1 : 1)];
      event.preventDefault();
      onClose("tab");
      requestAnimationFrame(() => target?.focus());
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") || [])];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items.at(-1)?.focus();
    else {
      const offset = event.key === "ArrowDown" ? 1 : -1;
      items[(current + offset + items.length) % items.length]?.focus();
    }
    event.preventDefault();
  }
  const pauseLabel = pending === "pause"
    ? project.paused ? "Resuming agents" : "Pausing agents"
    : project.paused ? "Resume agents" : "Pause agents";
  const removalCopy = projectRemovalCopy(project);
  if (confirming) {
    const deleting = pending === "delete";
    return <Modal title={removalCopy.heading} open compact role="alertdialog" closeDisabled={deleting} onClose={() => onClose("escape")}>
      <form className={styles.confirmation} aria-busy={deleting} onSubmit={(event) => {
        event.preventDefault();
        void runMutation("delete", onDelete);
      }}>
        <div className={styles.confirmationBody}>
          <div className={styles.removalWarning}>
            <TriangleAlert aria-hidden="true" size={18} />
            <p>{removalCopy.explanation}</p>
          </div>
          {error && <p id="project-delete-error" className={styles.error} role="alert">{error}</p>}
        </div>
        <div className={styles.confirmationActions}>
          <Button variant="secondary" type="button" data-modal-autofocus className={styles.secondary} disabled={deleting} onClick={() => onClose("escape")}>Cancel</Button>
          <Button variant="danger" ref={deleteButton} type="submit" className={styles.dangerAction} aria-describedby={error ? "project-delete-error" : undefined} disabled={deleting}>
            <Trash2 size={14} />{deleting ? removalCopy.pending : removalCopy.action}
          </Button>
        </div>
      </form>
    </Modal>;
  }
  return <OverlayPortal layer="menu">{(layerProps) =>
    <div {...layerProps} ref={root} role="menu" aria-label={`${project.name} project actions`} aria-busy={pending ? "true" : undefined} className={styles.menu} style={{ ...layerProps.style, ...position }} onKeyDown={moveMenuFocus}>
      <>
        <div className={styles.header}><IdentityMark name={project.name} avatarUrl={avatar} color={color} /><div><strong>{project.name}</strong><StatusIndicator status={project.paused ? "paused" : "running"} size="compact" /></div></div>
        <div className={styles.group}>
          <Button variant="menu" role="menuitem" disabled={pending === "pause"} onClick={() => { if (!pendingMutation.current) onAppearance(); }}><Palette size={15} /><span>Appearance</span><i style={{ background: color }} /></Button>
          <Button variant="menu" role="menuitem" disabled={pending === "pause"} onClick={() => { if (!pendingMutation.current) onWorkflow(); }}><Settings2 size={15} /><span>Project workflow</span></Button>
        </div>
        <div className={styles.group}>
          <Button variant="menu" ref={pauseButton} role="menuitem" disabled={pending === "pause"} aria-describedby={error ? "project-pause-error" : undefined} onClick={() => void runMutation("pause", onPause)}>{project.paused ? <CirclePlay size={15} /> : <CirclePause size={15} />}<span>{pauseLabel}</span></Button>
          {error && <p id="project-pause-error" className={styles.error} role="alert">{error}</p>}
        </div>
        <div className={styles.group}>
          <Button variant="menu" role="menuitem" className={styles.danger} disabled={pending === "pause"} onClick={() => {
            if (pendingMutation.current) return;
            setError("");
            setConfirming(true);
          }}><Trash2 size={15} /><span>{removalCopy.menuItem}</span></Button>
        </div>
      </>
    </div>
  }</OverlayPortal>;
}

