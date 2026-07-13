"use client";

import type { Agent } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import styles from "./AgentColorSettings.module.css";

interface Props { agents: Agent[]; colors: Record<string, string>; onChange: (colors: Record<string, string>) => void; }

export function AgentColorSettings({ agents, colors, onChange }: Props) {
  return (
    <div className={styles.list}>
      <p>Agent colors</p>
      {agents.map((agent) => (
        <label key={agent.id}>
          <span style={{ background: agentColor(agent.id, colors) }} />
          <strong>{agent.id}</strong>
          <input aria-label={`${agent.id} color`} type="color" value={agentColor(agent.id, colors)} onChange={(event) => onChange({ ...colors, [agent.id]: event.target.value })} />
        </label>
      ))}
    </div>
  );
}
