import type { Agent } from "./types";

export interface AgentCapability {
  label: string;
  detail: string;
}

/**
 * Describes what an agent can actually do, matching the tool list Harness
 * hands it at runtime: the project leader, and any worker explicitly granted
 * delegation via the project's `delegate_agents` setting, can delegate tasks
 * or message another agent directly; idea agents can only file new work;
 * every other agent can only check team status. This intentionally mirrors
 * the backend's per-role MCP tool scoping (see `tools()` in `mcp_server.rs`
 * and the `delegate_agents` project setting) so the dashboard never implies
 * a capability an agent does not actually have.
 */
export function agentCapability(agent: Pick<Agent, "isLeader" | "isIdeaAgent" | "isDelegate">): AgentCapability {
  if (agent.isLeader) {
    return {
      label: "Delegates work",
      detail: "Can delegate tasks and message any agent directly.",
    };
  }
  if (agent.isDelegate) {
    return {
      label: "Delegates work",
      detail: "Granted delegation: can delegate tasks and message any agent directly, without being project leader.",
    };
  }
  if (agent.isIdeaAgent) {
    return {
      label: "Files new work",
      detail: "Can create new tasks, but never contacts other agents.",
    };
  }
  return {
    label: "Status only",
    detail: "Can check team status, but cannot delegate or message other agents.",
  };
}
