import type { QueueItem } from "@/lib/types";
import { QueueRow } from "../QueueRow/QueueRow";
import styles from "./TaskList.module.css";

interface Props { drafts: QueueItem[]; tasks: QueueItem[]; editor?: React.ReactNode; onOpen: (item: QueueItem) => void; }

export function TaskList({ drafts, tasks, editor, onOpen }: Props) {
  const active = tasks.filter((item) => !isDone(item.status));
  const completed = tasks.filter((item) => isDone(item.status));
  return (
    <div className={styles.list}>
      {drafts.map((item) => <QueueRow key={item.id} item={item} onClick={() => onOpen(item)} />)}
      {active.map((item) => <QueueRow key={item.id} item={item} onClick={() => onOpen(item)} />)}
      {!drafts.length && !active.length && !editor && <div className={styles.empty}>No active tasks</div>}
      {editor}
      {completed.length > 0 && <details className={styles.completed}>
        <summary>{completed.length} completed {completed.length === 1 ? "task" : "tasks"}</summary>
        {completed.map((item) => <QueueRow key={item.id} item={item} onClick={() => onOpen(item)} />)}
      </details>}
    </div>
  );
}

function isDone(status: string) {
  return status === "done" || status === "completed" || status === "released";
}
