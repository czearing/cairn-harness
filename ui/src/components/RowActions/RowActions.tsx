"use client";

import { Button } from "@/components/Button/Button";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal, Trash2, XCircle } from "lucide-react";
import { OverlayPortal } from "../OverlayPortal/OverlayPortal";
import styles from "./RowActions.module.css";

interface Props {
  label: string;
  cancelLabel?: string;
  deleteLabel?: string;
  onCancel?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}

type ActionState =
  | { status: "idle" }
  | { status: "confirm" | "pending"; kind: "cancel" | "delete" }
  | { status: "error"; kind: "cancel" | "delete"; message: string };

export function RowActions({ label, cancelLabel, deleteLabel, onCancel, onDelete }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const keyboardOpen = useRef(false);
  const requestPending = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const closeMenu = useRef((restoreFocus = false) => {
    setOpen(false);
    setAction({ status: "idle" });
    keyboardOpen.current = false;
    if (restoreFocus) trigger.current?.focus();
  });
  useEffect(() => {
    if (!open || !keyboardOpen.current) return;
    menu.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, [action, open]);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const triggerRect = trigger.current.getBoundingClientRect();
    const menuRect = menu.current.getBoundingClientRect();
    const below = triggerRect.bottom + 4;
    const top = below + menuRect.height <= window.innerHeight - 8
      ? below
      : Math.max(8, triggerRect.top - menuRect.height - 4);
    const left = Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, triggerRect.right - menuRect.width));
    setPosition({ top, left });
  }, [action, open]);
  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && (menu.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node))) return;
      closeMenu.current(event instanceof KeyboardEvent);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  function moveMenuFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      const menuElement = event.currentTarget;
      const focusable = [...document.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter((item) => !menuElement.contains(item));
      const triggerIndex = focusable.indexOf(trigger.current as HTMLElement);
      focusable[triggerIndex + (event.shiftKey ? -1 : 1)]?.focus();
      closeMenu.current();
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") || [])];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    items[(current + offset + items.length) % items.length]?.focus();
    event.preventDefault();
  }
  async function runAction(kind: "cancel" | "delete", request: () => Promise<void>) {
    if (requestPending.current) return;
    requestPending.current = true;
    setAction({ status: "pending", kind });
    try {
      await request();
      closeMenu.current(true);
    } catch (reason) {
      const message = reason instanceof Error && reason.message
        ? reason.message
        : typeof reason === "string" && reason.trim() ? reason : "Action failed. Try again.";
      setAction({ status: "error", kind, message });
    } finally {
      requestPending.current = false;
    }
  }
  const pending = action.status === "pending";
  return <>
    <Button variant="inherit" ref={trigger} className={styles.trigger} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(event) => {
      if (open) {
        closeMenu.current();
        return;
      }
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 190) });
      keyboardOpen.current = event.detail === 0;
      setAction({ status: "idle" });
      setOpen(true);
    }}><MoreHorizontal size={14} /></Button>
    {open && <OverlayPortal layer="menu">{(layerProps) => <div {...layerProps} ref={menu} role="menu" aria-busy={pending} className={styles.menu} style={{ ...layerProps.style, ...position }} onKeyDown={moveMenuFocus}>
      {onCancel && (action.status === "idle" || action.kind !== "cancel"
        ? <Button variant="menu" role="menuitem" disabled={pending} onClick={() => setAction({ status: "confirm", kind: "cancel" })}><XCircle size={14} />{cancelLabel || "Cancel"}</Button>
        : <Button variant="menu" role="menuitem" aria-busy={pending} disabled={pending} className={styles.danger} onClick={() => void runAction("cancel", onCancel)}><XCircle size={14} />Confirm cancellation</Button>)}
      {onDelete && (action.status === "idle" || action.kind !== "delete"
        ? <Button variant="menu" role="menuitem" disabled={pending} className={styles.danger} onClick={() => setAction({ status: "confirm", kind: "delete" })}><Trash2 size={14} />{deleteLabel || "Delete"}</Button>
        : <Button variant="menu" role="menuitem" aria-busy={pending} disabled={pending} className={styles.danger} onClick={() => void runAction("delete", onDelete)}><Trash2 size={14} />Delete permanently</Button>)}
      {action.status === "error" && <p role="alert" className={styles.error}>{action.message}</p>}
    </div>}</OverlayPortal>}
  </>;
}
