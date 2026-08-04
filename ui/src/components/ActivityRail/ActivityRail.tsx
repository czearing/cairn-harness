"use client";

import { Button } from "@/components/Button/Button";

import { useEffect, useId, useRef, useState } from "react";
import { Activity as ActivityIcon, ListX } from "lucide-react";
import { eligibleDescendants } from "@/lib/focus";
import type { Agent, Project } from "@/lib/types";
import { ActivityFeed } from "../ActivityFeed/ActivityFeed";
import { DashboardPane, DashboardPaneBody, DashboardPaneHeader } from "../DashboardPane/DashboardPane";
import styles from "./ActivityRail.module.css";

interface Props {
  project: Project;
  cutoff?: string;
  responsiveVisible?: boolean;
  onClear: () => void;
  onOpen: (agent: Agent, focusId: string) => void;
}

export function ActivityRail({ project, cutoff, responsiveVisible, onClear, onOpen }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTrigger = useRef<HTMLButtonElement>(null);
  const clearDialog = useRef<HTMLDivElement>(null);
  const cancelClear = useRef<HTMLButtonElement>(null);
  const titleId = `${useId()}-activity-clear-title`;
  const descriptionId = `${useId()}-activity-clear-description`;
  const activity = cutoff ? project.activity.filter((item) => item.completedAt > cutoff) : project.activity;
  const closeConfirmation = useRef(() => {
    setConfirmClear(false);
    requestAnimationFrame(() => clearTrigger.current?.focus());
  });
  useEffect(() => {
    if (!confirmClear) return;
    const focusFrame = requestAnimationFrame(() => cancelClear.current?.focus());
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent
        && (clearDialog.current?.contains(event.target as Node) || clearTrigger.current?.contains(event.target as Node))) return;
      closeConfirmation.current();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [confirmClear]);
  function containFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !clearDialog.current) return;
    const items = eligibleDescendants(clearDialog.current);
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
  return <DashboardPane id="recent-activity-rail" className={styles.activity} aria-label="Recent activity" data-responsive-visible={responsiveVisible || undefined}>
    <DashboardPaneHeader className={styles.title}><ActivityIcon size={14} /><span>Recent activity</span><div className={styles.clearWrap}>
      <Button variant="inherit" ref={clearTrigger} aria-label="Clear recent activity" title="Clear recent activity" aria-disabled={!activity.length} onClick={() => {
        if (!activity.length) return;
        if (confirmClear) closeConfirmation.current();
        else setConfirmClear(true);
      }}><ListX size={13} /></Button>
      {confirmClear && <div ref={clearDialog} className={styles.clearMenu} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={containFocus}>
        <strong id={titleId}>Hide current activity?</strong><span id={descriptionId}>Agent history and transcripts are preserved.</span><div>
          <Button variant="secondary" ref={cancelClear} onClick={() => closeConfirmation.current()}>Cancel</Button>
          <Button variant="danger" onClick={() => { onClear(); closeConfirmation.current(); }}>Clear</Button>
        </div>
      </div>}
    </div></DashboardPaneHeader>
    <DashboardPaneBody className={styles.body}>
      <ActivityFeed activity={activity} agents={project.agents} onOpen={onOpen} />
    </DashboardPaneBody>
  </DashboardPane>;
}
