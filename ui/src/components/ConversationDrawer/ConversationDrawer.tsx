"use client";

import { useEffect, useRef, useState } from "react";
import type { Agent } from "@/lib/types";
import { useConversation } from "@/lib/use-conversation";
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
  const [watching, setWatching] = useState(false);
  const watchStart = useRef("");
  const conversation = useConversation(projectId, agent.id, focusId, watching);
  useEffect(() => {
    if (!watching || !watchStart.current) return;
    const replied = conversation.messages.some((message) => message.timestamp > watchStart.current && message.sender !== "dashboard" && message.sender !== "human");
    if (replied) setWatching(false);
  }, [conversation.messages, watching]);
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
    watchStart.current = new Date().toISOString();
    setWatching(true);
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
