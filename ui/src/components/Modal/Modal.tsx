"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./Modal.module.css";

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement as HTMLElement;
    const shell = document.querySelector<HTMLElement>("[data-app-shell]");
    shell?.setAttribute("inert", "");
    const focusFrame = requestAnimationFrame(() => {
      const initial = dialog.current?.querySelector<HTMLElement>("[data-modal-autofocus]")
        || dialog.current?.querySelector<HTMLElement>("input, button");
      initial?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      shell?.removeAttribute("inert");
      requestAnimationFrame(() => previous.current?.focus());
    };
  }, [open]);
  if (!open) return null;
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div ref={dialog} className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onKeyDown={keyDown} onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2><button aria-label="Close" onClick={onClose}><X size={16} /></button></header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
