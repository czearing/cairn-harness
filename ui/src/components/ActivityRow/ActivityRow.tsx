import { Check, X } from "lucide-react";
import type { Activity } from "@/lib/types";
import styles from "./ActivityRow.module.css";

export function ActivityRow({ activity, onClick }: { activity: Activity; onClick?: () => void }) {
  const failed = activity.status !== "completed";
  return (
    <button className={styles.row} onClick={onClick}>
      <span className={`${styles.icon} ${failed ? styles.failed : ""}`}>{failed ? <X size={12} /> : <Check size={12} />}</span>
      <span className={styles.copy}><strong>{activity.agent}</strong><span>{activity.summary}</span></span>
      <time>{formatTime(activity.completedAt)}</time>
    </button>
  );
}

function formatTime(value: string) {
  if (!value) return "now";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
