import { CircleDot } from "lucide-react";
import type { QueueItem } from "@/lib/types";
import styles from "./QueueRow.module.css";

export function QueueRow({ item }: { item: QueueItem }) {
  return (
    <div className={styles.row}>
      <CircleDot size={14} />
      <div><strong>{item.title}</strong><span>{item.meta}</span></div>
      <span className={styles.status}>{item.status}</span>
    </div>
  );
}
