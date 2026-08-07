import type { Project } from "./types.ts";
import { taskStatusPresentation } from "./task-status.ts";

export interface ProjectActivity {
  status: "paused" | "failed" | "working" | "queued" | "idle";
  label: string;
  activeCount: number;
}

const ATTENTION_AGENT_STATUSES = new Set(["failed", "budget-exhausted"]);

// Root tasks are the unit the rail summarises, and the server returns them for every assignee, kind and
// source. activeWorkCount is deliberately NOT consulted: it counts only the leader's hand-typed work
// items, so imported and directly assigned work, the bulk of a busy project, is invisible to it.
// Anything not yet finished counts, including paused, deferred and blocked work: pausing a project must
// not appear to empty its queue.
export function activeWorkCount(project: Project): number {
  return project.workItems.filter((item) => !taskStatusPresentation(item.status).terminal).length;
}

// Ordered by what an operator must not miss: a stopped project, then agents that need a human, then work
// actually executing, then work admitted but not yet started. Anything else is genuinely nothing happening
// and must read as nothing happening rather than as success.
export function projectActivity(project: Project): ProjectActivity {
  const activeCount = activeWorkCount(project);
  if (project.paused) return { status: "paused", label: "Project paused", activeCount };
  const attention = project.agents.filter((agent) => ATTENTION_AGENT_STATUSES.has(agent.status));
  if (attention.length) {
    return { status: "failed", label: agentLabel(attention.length, "needs attention", "need attention"), activeCount };
  }
  const working = project.agents.filter((agent) => agent.status === "working");
  if (working.length) {
    const topic = working.length === 1 ? working[0].topic : undefined;
    return {
      status: "working",
      label: topic ? `${working[0].title || working[0].id}: ${topic}` : agentLabel(working.length, "working", "working"),
      activeCount,
    };
  }
  if (activeCount > 0) {
    return { status: "queued", label: `${activeCount} ${activeCount === 1 ? "item" : "items"} queued`, activeCount };
  }
  return { status: "idle", label: "No active work", activeCount };
}

function agentLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? "agent" : "agents"} ${count === 1 ? singular : plural}`;
}
