import type { CSSProperties } from "react";
import type { Agent, QueueItem } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import styles from "./DelegatedTodoRow.module.css";

interface Props { item: QueueItem; agent?: Agent; color?: string; avatar?: string; onClick?: () => void; }

export function DelegatedTodoRow({ item, agent, color, avatar, onClick }: Props) {
  const name = agent?.id || item.agentId || "Agent";
  const identity = { "--todo-color": color || agentColor(name) } as CSSProperties;
  return (
    <button style={identity} className={styles.row} onClick={onClick}>
      <span className={styles.avatar} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>{!avatar && name.slice(0, 2).toUpperCase()}</span>
      <span className={styles.copy}><span>Assigned to <strong>{name}</strong></span><b>{item.title}</b><small>{item.context}</small></span>
      <span className={styles.status}>{item.status}</span>
    </button>
  );
}
