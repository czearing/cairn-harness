"use client";

import { Crown, Sparkles } from "lucide-react";
import type { Agent } from "@/lib/types";
import { agentTitle } from "@/lib/agent-label";
import { dashboardHref } from "@/lib/dashboard-route";
import { AgentActionsMenu } from "../AgentActionsMenu/AgentActionsMenu";
import type { AgentDeletionPreview } from "../AgentWorkspace/agent-workspace-types";
import { AgentCardSurface } from "./AgentCardSurface";

interface Props {
  projectId: string; agent: Agent; color?: string; avatar?: string;
  onClick?: (returnFocus: HTMLElement) => void;
  onConfigure?: (returnFocus: HTMLElement) => void;
  onPrefetch?: () => void;
  onPauseToggle?: () => Promise<void>;
  onClearContext?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onDeletionPreview?: () => Promise<AgentDeletionPreview>;
}

export function AgentCard({ projectId, agent, color, avatar, onClick, onConfigure, onPrefetch, onPauseToggle, onClearContext, onDelete, onDeletionPreview }: Props) {
  const title = agentTitle(agent);
  const settingsHref = dashboardHref({ kind: "agent-settings", projectId, agentId: agent.id });
  return <AgentCardSurface
    agentId={agent.id}
    avatar={avatar}
    avatarBadge={agent.isLeader
      ? <Crown size={12} />
      : agent.isIdeaAgent
        ? <Sparkles size={11} />
        : undefined}
    avatarBadgeLabel={agent.isLeader ? "Project leader" : agent.isIdeaAgent ? "Idea agent" : undefined}
    avatarBadgePlacement={agent.isIdeaAgent ? "bottom" : "top"}
    avatarBadgeTone={agent.isLeader ? "warning" : "info"}
    color={color}
    initials={agent.id.slice(0, 2).toUpperCase()}
    onConfigure={onConfigure}
    onPrefetch={onPrefetch}
    onPrimary={onClick}
    primaryHref={dashboardHref({ kind: "conversation", projectId, agentId: agent.id })}
    primaryLabel={`Open conversation with ${agent.id}`}
    renderActions={onPauseToggle || onClearContext || onDelete
      ? (triggerClassName) => <AgentActionsMenu
          agent={agent}
          label={title}
          triggerClassName={triggerClassName}
          settingsHref={settingsHref}
          onSettings={onConfigure}
          onPauseToggle={onPauseToggle}
          onClearContext={onClearContext}
          onDelete={onDelete}
          onDeletionPreview={onDeletionPreview}
        />
      : undefined}
    settingsHref={settingsHref}
    settingsLabel={`Configure ${agent.id}`}
    status={agent.status}
    title={title}
    variant={agent.isLeader ? "leader" : "agent"}
  />;
}
