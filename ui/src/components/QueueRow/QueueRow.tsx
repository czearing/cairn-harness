import { CircleDot } from "lucide-react";
import type { QueueItem } from "@/lib/types";
import styles from "./QueueRow.module.css";

export function QueueRow({ item, onClick }: { item: QueueItem; onClick?: () => void }) {
  const active = item.status === "queued" || item.status === "in-progress" || item.status === "in progress";
  return (
    <button className={`${styles.row} ${active ? styles.active : ""}`} onClick={onClick}>
      <CircleDot size={14} />
      <span className={styles.copy}><strong>{item.title}</strong>{item.context && <span>{item.context}</span>}</span>
      <span className={styles.status}>{item.status}</span>
    </button>
  );
}
