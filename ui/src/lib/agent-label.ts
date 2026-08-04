import type { Agent } from "./types";

export function displayAgentId(id: string) {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function agentTitle(agent: Agent) {
  return agent.title || displayAgentId(agent.id);
}
