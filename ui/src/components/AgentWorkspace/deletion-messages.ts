import type { AgentDeletionPreview } from "./agent-workspace-types";

export interface DeletionBlocker { title: string; detail: string; }

function shortId(value?: string) {
  return value && value.length > 12 ? `${value.slice(0, 8)}\u2026` : value;
}

/**
 * A blocked deletion must name the specific reason and the step that clears it, so the
 * control is never a dead end the user has to guess their way out of.
 */
export function agentDeletionBlockers(preview: AgentDeletionPreview, agentLabel: string): DeletionBlocker[] {
  const activeWork = preview.blockers.filter((blocker) => blocker.code === "active_work");
  const blockers: DeletionBlocker[] = [];
  if (preview.blockers.some((blocker) => blocker.code === "leader")) {
    blockers.push({
      title: `${agentLabel} is the project lead.`,
      detail: "Open another agent in this project and choose \u201cMake project lead\u201d, then delete this one. A project always keeps exactly one lead.",
    });
  }
  if (activeWork.length) {
    blockers.push({
      title: `${activeWork.length} task${activeWork.length === 1 ? " is" : "s are"} still assigned.`,
      detail: `Wait for that work to finish or cancel it, then delete. Blocking: ${activeWork
        .slice(0, 4)
        .map((blocker) => `${shortId(blocker.claimId) || blocker.agentId}${blocker.status ? ` (${blocker.status})` : ""}`)
        .join(", ")}${activeWork.length > 4 ? `, and ${activeWork.length - 4} more` : ""}.`,
    });
  }
  return blockers;
}

export function agentDeletionConsequence(preview: AgentDeletionPreview, agentLabel: string) {
  const others = preview.affected.filter((entry) => entry.id !== preview.targetId);
  return others.length
    ? `Permanently deletes ${agentLabel} and ${others.length} agent instance${others.length === 1 ? "" : "s"} derived from it (${others.map((entry) => entry.id).join(", ")}). This cannot be undone.`
    : `Permanently deletes ${agentLabel}, including its instructions and conversation history. This cannot be undone.`;
}
