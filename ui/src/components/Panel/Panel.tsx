import type { ReactNode } from "react";
import styles from "./Panel.module.css";

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <header><h2>{title}</h2>{action}</header>
      <div>{children}</div>
    </section>
  );
}
