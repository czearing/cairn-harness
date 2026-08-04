"use client";

import { Crown, Sparkles } from "lucide-react";
import type { Agent } from "@/lib/types";
import { agentTitle } from "@/lib/agent-label";
import { dashboardHref } from "@/lib/dashboard-route";
import { AgentCardSurface } from "./AgentCardSurface";

interface Props {
  projectId: string; agent: Agent; color?: string; avatar?: string;
  onClick?: (returnFocus: HTMLElement) => void;
  onConfigure?: (returnFocus: HTMLElement) => void;
  onPrefetch?: () => void;
}

export function AgentCard({ projectId, agent, color, avatar, onClick, onConfigure, onPrefetch }: Props) {
  const title = agentTitle(agent);
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
    settingsHref={dashboardHref({ kind: "agent-settings", projectId, agentId: agent.id })}
    settingsLabel={`Configure ${agent.id}`}
    status={agent.status}
    title={title}
    variant={agent.isLeader ? "leader" : "agent"}
  />;
}
