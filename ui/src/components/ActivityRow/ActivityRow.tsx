import { Check, X } from "lucide-react";
import type { Activity } from "@/lib/types";
import styles from "./ActivityRow.module.css";

export function ActivityRow({ activity }: { activity: Activity }) {
  const failed = activity.status !== "completed";
  return (
    <div className={styles.row}>
      <span className={`${styles.icon} ${failed ? styles.failed : ""}`}>
        {failed ? <X size={12} /> : <Check size={12} />}
      </span>
      <div><strong>{activity.agent}</strong><p>{activity.summary}</p></div>
      <time>{formatTime(activity.completedAt)}</time>
    </div>
  );
}

function formatTime(value: string) {
  if (!value) return "now";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
