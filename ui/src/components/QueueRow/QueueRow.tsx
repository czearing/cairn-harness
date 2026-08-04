import { Button } from "@/components/Button/Button";
import type { QueueItem } from "@/lib/types";
import { taskPresentation } from "@/lib/work-map";
import { workBody } from "@/lib/work-body";
import { RowActions } from "../RowActions/RowActions";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import styles from "./QueueRow.module.css";

export function QueueRow({ item, onClick, onCancel, onDelete }: { item: QueueItem; onClick?: () => void; onCancel?: () => Promise<void>; onDelete?: () => Promise<void> }) {
  const status = taskPresentation(item);
  const active = status.canonical === "running";
  return (
    <div className={styles.wrap}><Button variant="inherit" className={`${styles.row} ${active ? styles.active : ""}`} onClick={onClick}>
      <span className={styles.copy}><span data-work-body className={styles.body}>{workBody(item)}</span>{item.context && <span>{item.context}</span>}</span>
      <StatusIndicator status={status.canonical} label={status.label} size="compact" />
    </Button>{(onCancel || onDelete) && <RowActions label={`Actions for task ${workBody(item)}`} cancelLabel="Cancel task" deleteLabel="Delete task" onCancel={onCancel} onDelete={onDelete} />}</div>
  );
}
