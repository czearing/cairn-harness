import { ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";
import styles from "./ProjectNavItem.module.css";

interface Props { name: string; count: number; color?: string; active?: boolean; inProgress?: boolean; onClick?: () => void; }

export function ProjectNavItem({ name, count, color, active, inProgress, onClick }: Props) {
  const identity = { "--project-color": color } as CSSProperties;
  return (
    <button style={identity} className={`${styles.item} ${active ? styles.active : ""} ${inProgress ? styles.progress : ""}`} onClick={onClick}>
      <span className={styles.mark}>{name.slice(0, 1).toUpperCase()}</span>
      <span className={styles.name}>{name}</span>
      <span className={styles.count} aria-label={`${count} tasks`}>{count}</span>
      <ChevronRight size={14} />
    </button>
  );
}
