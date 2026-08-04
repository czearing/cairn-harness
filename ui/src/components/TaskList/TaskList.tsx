import type { QueueItem } from "@/lib/types";
import { QueueRow } from "../QueueRow/QueueRow";
import styles from "./TaskList.module.css";

interface Props { drafts: QueueItem[]; tasks: QueueItem[]; onOpen: (item: QueueItem) => void; onCancel: (item: QueueItem) => Promise<void>; onDelete: (item: QueueItem) => Promise<void>; }

export function TaskList({ drafts, tasks, onOpen, onCancel, onDelete }: Props) {
  const active = tasks.filter((item) => !isDone(item.status));
  const completed = tasks.filter((item) => isDone(item.status));
  return (
    <div className={styles.list}>
      {drafts.map((item) => <QueueRow key={item.id} item={item} onClick={() => onOpen(item)} />)}
      {active.map((item) => <QueueRow key={item.id} item={item} onClick={() => onOpen(item)} onCancel={() => onCancel(item)} />)}
      {!drafts.length && !active.length && <div className={styles.empty}>No active tasks</div>}
      {completed.length > 0 && <details className={styles.completed}>
        <summary>{completed.length} completed {completed.length === 1 ? "task" : "tasks"}</summary>
        {completed.map((item) => <QueueRow key={item.id} item={item} onClick={() => onOpen(item)} onDelete={() => onDelete(item)} />)}
      </details>}
    </div>
  );
}

function isDone(status: string) {
  return status === "done" || status === "completed" || status === "released" || status === "cancelled" || status === "failed" || status === "superseded";
}
