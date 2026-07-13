"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./ActionDrawer.module.css";

export function ActionDrawer({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const drawer = useRef<HTMLElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement as HTMLElement;
    const shell = document.querySelector<HTMLElement>("[data-app-shell]");
    shell?.setAttribute("inert", "");
    drawer.current?.querySelector<HTMLElement>("textarea, button")?.focus();
    return () => {
      shell?.removeAttribute("inert");
      previous.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
    if (event.key !== "Tab" || !drawer.current) return;
    const items = [...drawer.current.querySelectorAll<HTMLElement>("button, textarea, input, [tabindex]:not([tabindex='-1'])")];
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <aside ref={drawer} className={styles.drawer} role="dialog" aria-modal="true" aria-label={title} onKeyDown={keyDown} onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2><button aria-label="Close" onClick={onClose}><X size={16} /></button></header>
        <div>{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
