import { CircleDot } from "lucide-react";
import type { QueueItem } from "@/lib/types";
import styles from "./QueueRow.module.css";

export function QueueRow({ item, onClick }: { item: QueueItem; onClick?: () => void }) {
  return (
    <button className={styles.row} onClick={onClick}>
      <CircleDot size={14} />
      <span className={styles.copy}><strong>{item.title}</strong><span>{item.meta}</span></span>
      <span className={styles.status}>{item.status}</span>
    </button>
  );
}
