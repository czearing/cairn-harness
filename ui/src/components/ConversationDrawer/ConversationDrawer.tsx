"use client";

import type { Agent } from "@/lib/types";
import { useConversation } from "@/lib/use-conversation";
import { useProjectEvents } from "@/lib/use-project-events";
import { ChatPanel } from "../ChatPanel/ChatPanel";

interface Props {
  projectId: string;
  agent: Agent;
  colors: Record<string, string>;
  avatars: Record<string, string>;
  focusId?: string;
  onProjectMutate: () => Promise<unknown>;
}

export function ConversationDrawer({ projectId, agent, colors, avatars, focusId, onProjectMutate }: Props) {
  const conversation = useConversation(projectId, agent.id, focusId);
  useProjectEvents(() => void conversation.mutate());
  async function send(body: string) {
    const response = await fetch(`/api/projects/${projectId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: agent.id, body }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "Message failed" })) as { error?: string };
      throw new Error(data.error || "Message failed");
    }
    await Promise.all([conversation.mutate(), onProjectMutate()]);
  }
  return <ChatPanel
    agent={agent}
    messages={conversation.messages}
    colors={colors}
    avatars={avatars}
    focusId={focusId}
    hasMore={conversation.hasMore}
    loading={conversation.isLoading}
    loadingMore={conversation.isValidating}
    olderCount={conversation.olderCount}
    onLoadOlder={conversation.loadOlder}
    onSend={send}
  />;
}
