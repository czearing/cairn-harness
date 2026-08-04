import type { ReactNode } from "react";
import { Typography } from "../Typography/Typography";
import styles from "./Panel.module.css";

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <header><Typography as="h2" variant="eyebrow" tone="muted">{title}</Typography>{action}</header>
      <div>{children}</div>
    </section>
  );
}
