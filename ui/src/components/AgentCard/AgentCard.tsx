import type { Agent } from "@/lib/types";
import { StatusPill } from "../StatusPill/StatusPill";
import styles from "./AgentCard.module.css";

export function AgentCard({ agent, onClick }: { agent: Agent; onClick?: () => void }) {
  return (
    <button className={styles.card} onClick={onClick} aria-label={`Open conversation with ${agent.id}`}>
      <div className={styles.top}>
        <span className={styles.avatar}>{agent.id.slice(0, 2).toUpperCase()}</span>
        <StatusPill status={agent.status} />
      </div>
      <div className={styles.identity}>
        <h3>{agent.id}</h3>
        <p>{agent.role}</p>
      </div>
      <div className={styles.footer}>
        <span>{agent.topic || "No active work"}</span>
        <span className={styles.open}>Open chat</span>
      </div>
    </button>
  );
}
