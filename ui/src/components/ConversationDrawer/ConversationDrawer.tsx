"use client";

import { useRef, useState } from "react";
import type { Agent, ChatMessage } from "@/lib/types";
import { useConversation } from "@/lib/use-conversation";
import { useProjectEvents } from "@/lib/use-project-events";
import { submissionWarning, type PostJsonResult } from "../Dashboard/dashboard-requests";
import { useCoalescedRefresh } from "../Dashboard/use-coalesced-refresh";
import { ChatPanel } from "../ChatPanel/ChatPanel";

interface Props {
  projectId: string;
  agent: Agent;
  colors: Record<string, string>;
  avatars: Record<string, string>;
  focusId?: string;
  onConfigure: () => void;
  onReturnLatest?: () => void;
  onProjectMutate: () => Promise<unknown>;
  onSubmissionWarning: (warning?: string) => void;
}

export function ConversationDrawer({ projectId, agent, colors, avatars, focusId, onConfigure, onReturnLatest, onProjectMutate, onSubmissionWarning }: Props) {
  const conversation = useConversation(projectId, agent.id, focusId);
  const retryingHistoryRef = useRef(false);
  const [retryingHistory, setRetryingHistory] = useState(false);
  const scheduleConversationRefresh = useCoalescedRefresh(() => conversation.refreshLatest());
  useProjectEvents((event) => {
    if (event.projectId === projectId && event.conversations.includes(agent.id)) scheduleConversationRefresh();
  });
  async function retryHistory() {
    if (retryingHistoryRef.current || conversation.isValidating) return;
    retryingHistoryRef.current = true;
    setRetryingHistory(true);
    try {
      await conversation.mutate();
    } finally {
      retryingHistoryRef.current = false;
      setRetryingHistory(false);
    }
  }
  async function send(body: string, submissionId: string) {
    const timestamp = new Date().toISOString();
    const optimistic: ChatMessage = {
      id: `task:dashboard-message-${submissionId}`,
      submissionId,
      sender: "dashboard",
      recipient: agent.id,
      body,
      status: "pending",
      deliveryState: "sending",
      timestamp,
      direction: "incoming",
      kind: "message",
      uiStatus: "sending",
    };
    await conversation.upsertLatest(optimistic);
    if (focusId) onReturnLatest?.();
    let response: Response;
    try {
      response = await fetch(`/api/projects/${projectId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: agent.id, body, submissionId }),
      });
    } catch (error) {
      await conversation.upsertLatest({
        ...optimistic,
        uiStatus: "failed",
        deliveryState: "failed",
        status: error instanceof Error && error.message
          ? `Could not reach the harness server: ${error.message}`
          : "Could not reach the harness server. Check that it is running, then retry.",
      });
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      const status = data.error || `The harness server rejected this message (HTTP ${response.status}).`;
      await conversation.upsertLatest({ ...optimistic, uiStatus: "failed", deliveryState: "failed", status });
      return;
    }
    const result = await response.json().catch(() => ({})) as PostJsonResult;
    onSubmissionWarning(submissionWarning(result));
    await conversation.upsertLatest({
      ...optimistic,
      id: result.id ? `task:${result.id.replace(/^task:/, "")}` : optimistic.id,
      status: result.status || "pending",
      deliveryState: "queued",
      workerStarted: result.workerStarted,
      workerError: result.workerError,
      uiStatus: undefined,
    });
    if (focusId) {
      await onProjectMutate();
      return;
    }
    await Promise.all([conversation.refreshLatest(), onProjectMutate()]);
  }
  return <ChatPanel
    key={`${projectId}:${agent.id}:${focusId || "latest"}`}
    projectId={projectId}
    agent={agent}
    messages={conversation.messages}
    groupBreakIds={conversation.groupBreakIds}
    colors={colors}
    avatars={avatars}
    focusId={focusId}
    onConfigure={onConfigure}
    hasMore={conversation.hasMore}
    loading={conversation.isLoading}
    loadingMore={conversation.isValidating}
    historyError={conversation.error ? usefulError(conversation.error) : undefined}
    retryingHistory={retryingHistory || conversation.isValidating}
    olderCount={conversation.olderCount}
    onLoadOlder={conversation.loadOlder}
    onRetryHistory={() => void retryHistory()}
    onReturnLatest={onReturnLatest}
    onSend={send}
    onRetrySend={send}
  />;
}

function usefulError(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : "Could not load conversation";
}
