"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { Agent, ChatMessage } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { MessageBody } from "../MessageBody/MessageBody";
import { MessageComposer } from "../MessageComposer/MessageComposer";
import { StatusPill } from "../StatusPill/StatusPill";
import styles from "./ChatPanel.module.css";

interface Props {
  agent: Agent; messages: ChatMessage[]; colors?: Record<string, string>; avatars?: Record<string, string>; focusId?: string;
  hasMore?: boolean; loading?: boolean; loadingMore?: boolean; olderCount?: number;
  onLoadOlder?: () => void; onSend: (body: string) => Promise<void>;
}

export function ChatPanel({ agent, messages, colors = {}, avatars = {}, focusId, hasMore, loading, loadingMore, olderCount = 0, onLoadOlder, onSend }: Props) {
  const list = useRef<VirtuosoHandle>(null);
  const didInitialScroll = useRef(false);
  const firstIndex = 1_000_000 - olderCount;
  const focusIndex = focusId ? messages.findIndex((message) => message.id === focusId) : -1;
  useEffect(() => {
    if (!focusId) return;
    if (focusIndex < 0) return;
    list.current?.scrollToIndex({ index: focusIndex, align: "center" });
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [firstIndex, focusId, focusIndex]);
  useEffect(() => {
    if (focusId || didInitialScroll.current || !messages.length) return;
    didInitialScroll.current = true;
    requestAnimationFrame(() => list.current?.scrollToIndex({ index: messages.length - 1, align: "end" }));
  }, [firstIndex, focusId, messages.length]);
  useEffect(() => {
    if (focusId && focusIndex < 0 && hasMore && !loadingMore) onLoadOlder?.();
  }, [focusId, focusIndex, hasMore, loadingMore, onLoadOlder]);
  function itemContent(_index: number, message: ChatMessage) {
    return (
    <div className={`${styles.row} ${isUser(message) ? styles.rowOwn : ""}`}>
      <Bubble message={message} agent={agent.id} colors={colors} avatar={avatars[message.sender]} focused={message.id === focusId} />
    </div>
    );
  }
  return (
    <div className={styles.panel}>
      <header><div><h3>{agent.id}</h3><p>{agent.role}</p></div><StatusPill status={agent.status} /></header>
      {loading && !messages.length ? <div className={styles.empty}>Loading conversation</div> :
        <Virtuoso
          ref={list}
          className={styles.history}
          aria-label={`Conversation history with ${agent.id}`}
          data={messages}
          computeItemKey={(_index, message) => message.id}
          firstItemIndex={firstIndex}
          initialTopMostItemIndex={focusIndex >= 0 ? focusIndex : Math.max(0, messages.length - 1)}
          followOutput={(atBottom) => atBottom ? "auto" : false}
          startReached={() => hasMore && onLoadOlder?.()}
          itemContent={itemContent}
          components={{ Header: () => loadingMore && hasMore ? <div className={styles.loading}>Loading earlier messages</div> : null }}
        />}
      <div className={styles.composer}><MessageComposer agent={agent.id} onSend={onSend} /></div>
    </div>
  );
}

function Bubble({ message, agent, colors, avatar, focused }: { message: ChatMessage; agent: string; colors: Record<string, string>; avatar?: string; focused: boolean }) {
  if (message.kind === "tool") return <ToolBubble message={message} focused={focused} />;
  if (message.sender === "work-items" || message.sender === "todo-folder") {
    return <AssignmentBubble message={message} focused={focused} />;
  }
  const user = isUser(message);
  const sender = user ? "You" : message.sender;
  const identity = { "--sender-color": user ? "var(--accent)" : agentColor(message.sender, colors) } as CSSProperties;
  return (
    <article style={identity} tabIndex={-1} data-chat-id={message.id} className={`${styles.message} ${user ? styles.own : ""} ${message.kind !== "message" && message.kind !== "assistant" ? styles.event : ""} ${focused ? styles.focused : ""}`}>
      <div className={styles.meta}><span className={styles.avatar} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>{!avatar && sender.slice(0, 2).toUpperCase()}</span><strong>{sender}</strong><span>{message.title || `to ${message.recipient === agent ? agent : message.recipient}`}</span><time>{formatTime(message.timestamp)}</time></div>
      <MessageBody message={message} />
      <span className={styles.state}>{message.status}</span>
    </article>
  );
}

function AssignmentBubble({ message, focused }: { message: ChatMessage; focused: boolean }) {
  const task = message.sender === "work-items";
  return (
    <article tabIndex={-1} data-chat-id={message.id} className={`${styles.assignment} ${focused ? styles.focused : ""}`}>
      <div><strong>{task ? "Task assigned" : "Delegated task"}</strong><span>to {message.recipient}</span><time>{formatTime(message.timestamp)}</time></div>
      <MessageBody message={message} />
      <span className={styles.state}>{message.status}</span>
    </article>
  );
}

function ToolBubble({ message, focused }: { message: ChatMessage; focused: boolean }) {
  return (
    <article tabIndex={-1} data-chat-id={message.id} className={`${styles.tool} ${focused ? styles.focused : ""}`}>
      <div><span>Agent tool</span><strong>{message.title}</strong><time>{formatTime(message.timestamp)}</time></div>
      <MessageBody message={message} />
    </article>
  );
}

function isUser(message: ChatMessage) { return message.sender === "dashboard" || message.sender === "human"; }
function formatTime(value: string) {
  return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";
}
