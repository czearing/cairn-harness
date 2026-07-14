import type { CSSProperties } from "react";
import type { Agent, QueueItem } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { workBody } from "@/lib/work-body";
import { RowActions } from "../RowActions/RowActions";
import styles from "./DelegatedTodoRow.module.css";

interface Props { item: QueueItem; agent?: Agent; color?: string; avatar?: string; onClick?: () => void; onDelete?: () => Promise<void>; }

export function DelegatedTodoRow({ item, agent, color, avatar, onClick, onDelete }: Props) {
  const name = agent?.id || item.agentId || "Agent";
  const identity = { "--todo-color": color || agentColor(name) } as CSSProperties;
  return (
    <div className={styles.wrap}><button style={identity} className={styles.row} onClick={onClick}>
      <span className={styles.avatar} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>{!avatar && name.slice(0, 2).toUpperCase()}</span>
      <span className={styles.copy}><span><strong>{name}</strong> · {item.status}</span><span data-work-body className={styles.body}>{workBody(item)}</span><small>{item.context}</small></span>
    </button>{onDelete && <RowActions label={`Actions for delegated action ${workBody(item)}`} deleteLabel="Delete delegated action" onDelete={onDelete} />}</div>
  );
}
