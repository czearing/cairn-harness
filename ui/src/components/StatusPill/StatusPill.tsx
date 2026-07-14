import styles from "./StatusPill.module.css";

export function StatusPill({ status }: { status: string }) {
  const tone = status === "working" ? "active" : status === "failed" ? "danger" : status === "paused" ? "paused" : "idle";
  return (
    <span className={`${styles.pill} ${styles[tone]}`}>
      <span className={styles.dot} />
      {status}
    </span>
  );
}
