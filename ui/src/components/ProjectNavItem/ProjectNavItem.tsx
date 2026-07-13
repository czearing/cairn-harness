import { ChevronRight } from "lucide-react";
import styles from "./ProjectNavItem.module.css";

interface Props { name: string; count: number; active?: boolean; onClick?: () => void; }

export function ProjectNavItem({ name, count, active, onClick }: Props) {
  return (
    <button className={`${styles.item} ${active ? styles.active : ""}`} onClick={onClick}>
      <span className={styles.mark}>{name.slice(0, 1).toUpperCase()}</span>
      <span className={styles.name}>{name}</span>
      <span className={styles.count}>{count}</span>
      <ChevronRight size={14} />
    </button>
  );
}
