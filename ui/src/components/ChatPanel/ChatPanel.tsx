"use client";

import { useEffect, type CSSProperties } from "react";
import type { Agent, ChatMessage } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { MessageComposer } from "../MessageComposer/MessageComposer";
import { StatusPill } from "../StatusPill/StatusPill";
import styles from "./ChatPanel.module.css";

interface Props { agent: Agent; messages: ChatMessage[]; colors?: Record<string, string>; focusId?: string; onSend: (body: string) => Promise<void>; }

export function ChatPanel({ agent, messages, colors = {}, focusId, onSend }: Props) {
  useEffect(() => {
    if (!focusId) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(focusId)}"]`);
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId]);
  return (
    <div className={styles.panel}>
      <header><div><h3>{agent.id}</h3><p>{agent.role}</p></div><StatusPill status={agent.status} /></header>
      <div className={styles.history} aria-label={`Conversation history with ${agent.id}`}>
        {messages.length ? messages.map((message) => <Bubble key={message.id} message={message} agent={agent.id} colors={colors} focused={message.id === focusId} />) : <div className={styles.empty}>No messages yet</div>}
      </div>
      <div className={styles.composer}><MessageComposer agent={agent.id} onSend={onSend} /></div>
    </div>
  );
}

function Bubble({ message, agent, colors, focused }: { message: ChatMessage; agent: string; colors: Record<string, string>; focused: boolean }) {
  const user = message.sender === "dashboard" || message.sender === "human";
  const sender = user ? "You" : message.sender;
  const identity = { "--sender-color": user ? "var(--accent)" : agentColor(message.sender, colors) } as CSSProperties;
  return (
    <article style={identity} tabIndex={-1} data-chat-id={message.id} className={`${styles.message} ${user ? styles.own : ""} ${message.kind !== "message" && message.kind !== "assistant" ? styles.event : ""} ${focused ? styles.focused : ""}`}>
      <div className={styles.meta}>
        <span className={styles.avatar}>{sender.slice(0, 2).toUpperCase()}</span>
        <strong>{sender}</strong>
        <span>{message.title || `to ${message.recipient === agent ? agent : message.recipient}`}</span>
        <time>{formatTime(message.timestamp)}</time>
      </div>
      <p>{message.body}</p>
      <span className={styles.state}>{message.status}</span>
    </article>
  );
}

function formatTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
