import { CircleDot } from "lucide-react";
import type { QueueItem } from "@/lib/types";
import { workBody } from "@/lib/work-body";
import { RowActions } from "../RowActions/RowActions";
import styles from "./QueueRow.module.css";

export function QueueRow({ item, onClick, onCancel, onDelete }: { item: QueueItem; onClick?: () => void; onCancel?: () => Promise<void>; onDelete?: () => Promise<void> }) {
  const active = item.status === "queued" || item.status === "in-progress" || item.status === "in progress";
  return (
    <div className={styles.wrap}><button className={`${styles.row} ${active ? styles.active : ""}`} onClick={onClick}>
      <CircleDot size={14} />
      <span className={styles.copy}><span data-work-body className={styles.body}>{workBody(item)}</span>{item.context && <span>{item.context}</span>}</span>
      <span className={styles.status}>{statusLabel(item.status)}</span>
    </button>{(onCancel || onDelete) && <RowActions label={`Actions for task ${workBody(item)}`} cancelLabel="Cancel task" deleteLabel="Delete task" onCancel={onCancel} onDelete={onDelete} />}</div>
  );
}

function statusLabel(status: string) {
  if (status === "in-progress" || status === "in progress") return "Working";
  if (status === "paused") return "Paused";
  if (status === "cancelled") return "Cancelled";
  if (status === "done" || status === "completed") return "Done";
  return status;
}
