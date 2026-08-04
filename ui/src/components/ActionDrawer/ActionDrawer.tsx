"use client";

import { Button } from "@/components/Button/Button";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { eligibleDescendants } from "@/lib/focus";
import { OverlayPortal } from "../OverlayPortal/OverlayPortal";
import styles from "./ActionDrawer.module.css";

export function ActionDrawer({ title, ariaLabel, open, wide = false, returnFocus, onClose, children }: { title: string; ariaLabel?: string; open: boolean; wide?: boolean; returnFocus?: HTMLElement | null; onClose: () => void | Promise<void>; children: ReactNode }) {
  const drawer = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previous.current = returnFocus || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const shell = document.querySelector<HTMLElement>("[data-app-shell]");
    shell?.setAttribute("inert", "");
    const root = drawer.current;
    const focusInitial = () => {
      const initial = root?.querySelector<HTMLElement>("[data-drawer-initial-focus]");
      if (!initial?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      initial?.focus();
      return Boolean(initial);
    };
    let observer: MutationObserver | undefined;
    if (!focusInitial()) {
      const fallback = root && eligibleDescendants(root)[0];
      fallback?.focus();
      if (root) {
        observer = new MutationObserver(() => {
          if (focusInitial()) observer?.disconnect();
        });
        observer.observe(root, { childList: true, subtree: true });
      }
    }
    return () => {
      observer?.disconnect();
      shell?.removeAttribute("inert");
      requestAnimationFrame(() => previous.current?.focus());
    };
  }, [open, returnFocus]);

  if (!open) return null;
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") void onClose();
    if (event.key !== "Tab" || !drawer.current) return;
    const items = eligibleDescendants(drawer.current);
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
  return <OverlayPortal layer="drawer">{(layerProps) =>
    <div {...layerProps} className={styles.backdrop} role="presentation" onMouseDown={() => void onClose()}>
      <div ref={drawer} className={`${styles.drawer} ${wide ? styles.wide : ""}`} role="dialog" aria-modal="true" aria-label={ariaLabel || title} onKeyDown={keyDown} onMouseDown={(event) => event.stopPropagation()}>
        <header>{title && <h2 tabIndex={-1} data-drawer-initial-focus>{title}</h2>}<Button variant="inherit" aria-label="Close" onClick={() => void onClose()}><X size={16} /></Button></header>
        <div>{children}</div>
      </div>
    </div>
  }</OverlayPortal>;
}
