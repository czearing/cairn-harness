"use client";

import { useState } from "react";
import { Activity as ActivityIcon, ListX } from "lucide-react";
import type { Agent, Project } from "@/lib/types";
import { ActivityRow } from "../ActivityRow/ActivityRow";
import styles from "./ActivityRail.module.css";

interface Props {
  project: Project;
  cutoff?: string;
  onClear: () => void;
  onOpen: (agent: Agent, focusId: string) => void;
}

export function ActivityRail({ project, cutoff, onClear, onOpen }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const activity = cutoff ? project.activity.filter((item) => item.completedAt > cutoff) : project.activity;
  return <aside className={styles.activity} aria-label="Recent activity">
    <div className={styles.title}><ActivityIcon size={14} /><span>Recent activity</span>{activity.length > 0 && <div className={styles.clearWrap}>
      <button aria-label="Clear recent activity" title="Clear recent activity" onClick={() => setConfirmClear(!confirmClear)}><ListX size={13} /></button>
      {confirmClear && <div className={styles.clearMenu}><strong>Hide current activity?</strong><span>Agent history and transcripts are preserved.</span><div><button onClick={() => setConfirmClear(false)}>Cancel</button><button onClick={() => { onClear(); setConfirmClear(false); }}>Clear</button></div></div>}
    </div>}</div>
    {activity.length ? activity.map((item) => <ActivityRow key={item.id} activity={item} onClick={() => {
      const agent = project.agents.find((value) => value.id === item.agent);
      if (agent) onOpen(agent, item.chatId);
    }} />) : <div className={styles.blank}>No recent activity</div>}
  </aside>;
}
