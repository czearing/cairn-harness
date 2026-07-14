import { ChevronRight, Pause } from "lucide-react";
import type { CSSProperties } from "react";
import styles from "./ProjectNavItem.module.css";

interface Props { name: string; avatar?: string; count: number; color?: string; active?: boolean; paused?: boolean; inProgress?: boolean; onClick?: () => void; onContextMenu?: (event: React.MouseEvent) => void; }

export function ProjectNavItem({ name, avatar, count, color, active, paused, inProgress, onClick, onContextMenu }: Props) {
  const identity = { "--project-color": color } as CSSProperties;
  return (
    <button style={identity} className={`${styles.item} ${active ? styles.active : ""} ${paused ? styles.paused : ""} ${inProgress ? styles.progress : ""}`} onClick={onClick} onContextMenu={onContextMenu}>
      <span className={styles.mark} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>{!avatar && name.slice(0, 1).toUpperCase()}{paused && <Pause className={styles.pause} size={9} aria-label="Project paused" />}</span>
      <span className={styles.name}>{name}</span>
      <span className={styles.count} aria-label={`${count} tasks`}>{count}</span>
      <ChevronRight size={14} />
    </button>
  );
}
