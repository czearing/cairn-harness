"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CirclePause, CirclePlay, Palette, Trash2 } from "lucide-react";
import type { Project } from "@/lib/types";
import styles from "./ProjectContextMenu.module.css";

interface Props {
  project: Project;
  x: number;
  y: number;
  color: string;
  avatar?: string;
  onAppearance: () => void;
  onPause: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function ProjectContextMenu({ project, x, y, color, avatar, onAppearance, onPause, onDelete, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("button, input")?.focus();
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && root.current?.contains(event.target as Node)) return;
      onClose();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [onClose]);
  const position = { left: Math.min(x, window.innerWidth - 252), top: Math.min(y, window.innerHeight - 340) };
  return createPortal(
    <div ref={root} role="menu" aria-label={`${project.name} project actions`} className={styles.menu} style={position}>
      {!confirming ? <>
        <div className={styles.header}><span style={{ color, backgroundImage: avatar ? `url("${avatar}")` : undefined }}>{!avatar && project.name.slice(0, 1).toUpperCase()}</span><div><strong>{project.name}</strong><small>{project.paused ? "Paused" : "Running"}</small></div></div>
        <div className={styles.group}>
          <button role="menuitem" onClick={onAppearance}><Palette size={15} /><span>Appearance</span><i style={{ background: color }} /></button>
        </div>
        <div className={styles.group}>
          <button role="menuitem" onClick={() => void onPause()}>{project.paused ? <CirclePlay size={15} /> : <CirclePause size={15} />}<span>{project.paused ? "Resume agents" : "Pause agents"}</span></button>
        </div>
        <div className={styles.group}>
          <button role="menuitem" className={styles.danger} onClick={() => setConfirming(true)}><Trash2 size={15} /><span>Delete project…</span></button>
        </div>
      </> : <>
        <div className={styles.confirm}>
          <strong>Delete {project.name}?</strong>
          <p>This permanently removes its files and history. Type <b>{project.id}</b> to confirm.</p>
          <input autoFocus aria-label={`Confirm deletion of ${project.name}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          <button className={styles.danger} disabled={confirmation !== project.id} onClick={() => void onDelete()}><Trash2 size={14} />Delete permanently</button>
        </div>
      </>}
    </div>,
    document.body,
  );
}
