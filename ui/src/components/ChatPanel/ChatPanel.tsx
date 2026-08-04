"use client";

import { Button } from "@/components/Button/Button";

import { useEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { agentAppearanceOverride, projectAgentColor } from "@/lib/agent-appearance";
import { MessageComposer } from "../MessageComposer/MessageComposer";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import { chatGroupPosition, chatStartsDay, dayLabel, hasTruthfulWorkingIndicator, normalize } from "./chat-utils";
import { ActiveResponse, ChatBubble, HistoryError, isUser, sameToolRun, toolRun } from "./ChatMessageView";
import type { ChatPanelProps } from "./chat-panel-types";
import { ChatVirtualHistory } from "./ChatVirtualHistory";
import styles from "./ChatPanel.module.css";

export function ChatPanel({
  projectId, agent, messages, groupBreakIds = [], colors = {}, avatars = {}, focusId,
  loading, loadingMore, hasMore, historyError, retryingHistory, onLoadOlder, onRetryHistory, onReturnLatest, onSend,
  onRetrySend, onConfigure,
}: ChatPanelProps) {
  const history = useRef<HTMLDivElement>(null);
  const liveResponse = [...messages].reverse().find((message) => message.live);
  const historyMessages = messages.filter((message) => !message.live);
  const displayMessages = liveResponse ? [...historyMessages, liveResponse] : historyMessages;
  const groupBreaks = new Set(groupBreakIds);
  const title = agent.title || agent.id;
  const distinctRole = normalize(agent.role) !== normalize(agent.id);
  const working = hasTruthfulWorkingIndicator(agent, historyMessages);
  useEffect(() => {
    if (!focusId) return;
    const target = history.current?.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(focusId)}"]`);
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [focusId, historyMessages]);
  function itemContent(message: ChatMessage, index: number) {
    if (message.kind === "tool" && sameToolRun(message, displayMessages[index + 1])) {
      return <div className={styles.toolContinuation} aria-hidden="true" />;
    }
    const tools = message.kind === "tool" ? toolRun(displayMessages, index) : undefined;
    const separatorIndex = tools ? index - tools.length + 1 : index;
    return <div className={`${styles.row} ${isUser(message) ? styles.rowOwn : ""}`}>
      {chatStartsDay(displayMessages, separatorIndex) && <div className={styles.daySeparator} role="separator"><span>{dayLabel(message.timestamp)}</span></div>}
      <ChatBubble
        message={message}
        tools={tools}
        group={chatGroupPosition(displayMessages, index, groupBreaks.has(message.id), groupBreaks.has(displayMessages[index + 1]?.id))}
        displaySender={message.sender === agent.id ? title : message.sender}
        color={projectAgentColor(colors, projectId, message.sender)}
        avatar={agentAppearanceOverride(avatars, projectId, message.sender)}
        focused={tools ? tools.some((tool) => tool.id === focusId) : message.id === focusId}
        onRetry={onRetrySend}
      />
    </div>;
  }
  return <div className={styles.panel}>
    <div className={styles.panelHeader}>
      <div><h3>{title}</h3>{distinctRole && <p>{agent.role}</p>}</div>
      <div className={styles.headerActions}>
        <StatusIndicator status={agent.status} />
        {onConfigure && <Button variant="secondary" size="compact" type="button" onClick={onConfigure}><Pencil size={13} aria-hidden="true" />Edit agent</Button>}
      </div>
    </div>
    <div className={styles.historyRegion}>
      {historyError && !historyMessages.length ? <HistoryError message={historyError} retrying={retryingHistory} onRetry={onRetryHistory} /> : <>
        {historyError && <HistoryError stale message="Could not update conversation" retrying={retryingHistory} onRetry={onRetryHistory} />}
        {focusId && <div className={styles.focusContext}><span role="status">Showing related result</span><Button variant="secondary" size="compact" onClick={onReturnLatest}>Return to latest</Button></div>}
        {focusId ? <div ref={history} className={`${styles.history} ${styles.focusedHistory}`} role="log" tabIndex={0} aria-label={`Conversation history with ${agent.id}`}>
          {loading ? <div className={styles.empty}>Loading conversation</div> : historyMessages.map((message, index) => <div key={message.id}>{itemContent(message, index)}</div>)}
          {liveResponse ? itemContent(liveResponse, historyMessages.length) : working ? <ActiveResponse title={title} /> : null}
        </div> : <ChatVirtualHistory
          agentId={agent.id}
          messages={historyMessages}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadOlder={onLoadOlder}
          renderItem={itemContent}
          footer={liveResponse ? itemContent(liveResponse, historyMessages.length) : working ? <ActiveResponse title={title} /> : null}
        />}
      </>}
    </div>
    <div className={styles.composer}><MessageComposer projectId={projectId} agent={title} initialFocus={!focusId} onSend={onSend} /></div>
  </div>;
}
