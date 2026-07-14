"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Trash2, XCircle } from "lucide-react";
import styles from "./RowActions.module.css";

interface Props {
  label: string;
  cancelLabel?: string;
  deleteLabel?: string;
  onCancel?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function RowActions({ label, cancelLabel, deleteLabel, onCancel, onDelete }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [confirm, setConfirm] = useState<"cancel" | "delete">();
  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && (menu.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node))) return;
      setOpen(false);
      setConfirm(undefined);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return <>
    <button ref={trigger} className={styles.trigger} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 190) });
      setOpen(!open);
    }}><MoreHorizontal size={14} /></button>
    {open && createPortal(<div ref={menu} role="menu" className={styles.menu} style={position}>
      {onCancel && (confirm !== "cancel"
        ? <button role="menuitem" onClick={() => setConfirm("cancel")}><XCircle size={14} />{cancelLabel || "Cancel"}</button>
        : <button role="menuitem" className={styles.danger} onClick={() => void onCancel().then(() => setOpen(false))}><XCircle size={14} />Confirm cancellation</button>)}
      {onDelete && (confirm !== "delete"
        ? <button role="menuitem" className={styles.danger} onClick={() => setConfirm("delete")}><Trash2 size={14} />{deleteLabel || "Delete"}</button>
        : <button role="menuitem" className={styles.danger} onClick={() => void onDelete().then(() => setOpen(false))}><Trash2 size={14} />Delete permanently</button>)}
    </div>, document.body)}
  </>;
}
