import { MessageSquare } from "lucide-react";
import type { Agent } from "@/lib/types";
import { StatusPill } from "../StatusPill/StatusPill";
import styles from "./AgentCard.module.css";

export function AgentCard({ agent, onMessage }: { agent: Agent; onMessage?: () => void }) {
  return (
    <article className={styles.card}>
      <div className={styles.top}>
        <span className={styles.avatar}>{agent.id.slice(0, 2).toUpperCase()}</span>
        <StatusPill status={agent.status} />
      </div>
      <div>
        <h3>{agent.id}</h3>
        <p>{agent.role}</p>
      </div>
      <div className={styles.footer}>
        <span>{agent.topic || "No active work"}</span>
        <button aria-label={`Message ${agent.id}`} onClick={onMessage}><MessageSquare size={15} /></button>
      </div>
    </article>
  );
}
