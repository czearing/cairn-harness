"use client";

import { Button } from "@/components/Button/Button";

import { useEffect, useRef, useState } from "react";
import { Settings2, UserPlus } from "lucide-react";
import styles from "./AgentSectionActions.module.css";

export function AgentSectionActions({
  onAddAgent,
  onConfigureProject,
  onConfigureIdeas,
}: {
  onAddAgent: () => void;
  onConfigureProject: () => void;
  onConfigureIdeas: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && menu.current?.contains(event.target as Node)) return;
      setOpen(false);
      if (event instanceof KeyboardEvent) trigger.current?.focus();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return <div className={styles.actions}>
    <Button variant="secondary" size="compact" className={styles.add} onClick={onAddAgent}>
      <UserPlus size={13} aria-hidden="true" />Add agent
    </Button>
    <div className={styles.disclosure}>
      <Button variant="secondary" size="compact"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Settings2 size={13} aria-hidden="true" />Setup
      </Button>
      {open && <div ref={menu} className={styles.menu} role="menu">
        <Button variant="menu" role="menuitem" onClick={() => choose(onConfigureProject)}>Workflow</Button>
        <Button variant="menu" role="menuitem" onClick={() => choose(onConfigureIdeas)}>Idea agents</Button>
      </div>}
    </div>
  </div>;
}
