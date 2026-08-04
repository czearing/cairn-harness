import { Button } from "@/components/Button/Button";
import type { Activity } from "@/lib/types";
import { compactActivitySummary } from "@/lib/activity-feed";
import styles from "./ActivityRow.module.css";

interface Props {
  activity: Activity;
  agentLabel?: string;
  agentRemoved: boolean;
  onClick?: () => void;
}

export function ActivityRow({ activity, agentLabel = activity.agent, agentRemoved, onClick }: Props) {
  const summary = compactActivitySummary(activity);
  const content = <>
    <span className={styles.copy}>
      <span className={styles.summary}><span className={styles.summaryTitle}>{summary.title}</span>{summary.additional > 0 && <span className={styles.more}>+{summary.additional}</span>}<time dateTime={activity.completedAt} title={formatExactTime(activity.completedAt)}>{formatActivityTime(activity.completedAt)}</time></span>
      <span className={styles.meta}>{agentRemoved ? `Former ${agentLabel}` : agentLabel}</span>
    </span>
  </>;
  return agentRemoved
    ? <div className={styles.row}>{content}</div>
    : <Button variant="inherit" type="button" className={`${styles.row} ${styles.interactive}`} onClick={onClick}>{content}</Button>;
}

export function formatActivityTime(value: string) {
  if (!value) return "now";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatExactTime(value: string) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
