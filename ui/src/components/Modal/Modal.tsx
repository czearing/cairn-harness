"use client";

import { Button } from "@/components/Button/Button";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { eligibleDescendants } from "@/lib/focus";
import { OverlayPortal } from "../OverlayPortal/OverlayPortal";
import styles from "./Modal.module.css";

export function Modal({ title, open, compact = false, closeDisabled = false, role = "dialog", onClose, children }: {
  title: string;
  open: boolean;
  compact?: boolean;
  closeDisabled?: boolean;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement as HTMLElement;
    const shell = document.querySelector<HTMLElement>("[data-app-shell]");
    shell?.setAttribute("inert", "");
    const focusFrame = requestAnimationFrame(() => {
      const root = dialog.current;
      const initial = root && eligibleDescendants(root, "[data-modal-autofocus]")[0];
      const fallback = root && eligibleDescendants(root)[0];
      (initial || fallback)?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      shell?.removeAttribute("inert");
      requestAnimationFrame(() => previous.current?.focus());
    };
  }, [open]);
  if (!open) return null;
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !closeDisabled) onClose();
    if (event.key !== "Tab" || !dialog.current) return;
    const items = eligibleDescendants(dialog.current);
    const first = items[0];
    const last = items.at(-1);
    const active = document.activeElement;
    if (!items.includes(active as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return <OverlayPortal layer="modal">{(layerProps) =>
    <div {...layerProps} className={styles.backdrop} onMouseDown={() => { if (!closeDisabled) onClose(); }}>
      <div ref={dialog} className={`${styles.modal} ${compact ? styles.compact : ""}`} role={role} aria-modal="true" aria-label={title} onKeyDown={keyDown} onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2><Button variant="inherit" aria-label="Close" disabled={closeDisabled} onClick={onClose}><X size={16} /></Button></header>
        {children}
      </div>
    </div>
  }</OverlayPortal>;
}
