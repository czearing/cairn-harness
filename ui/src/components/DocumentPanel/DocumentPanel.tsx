import type { QueueItem } from "@/lib/types";
import styles from "./DocumentPanel.module.css";

export function DocumentPanel({ item }: { item: QueueItem }) {
  return (
    <article className={styles.panel}>
      <header><span>{item.status}</span><h3>{item.title}</h3><p>{item.meta}</p></header>
      <pre>{item.content || "This file is not available on disk."}</pre>
    </article>
  );
}
