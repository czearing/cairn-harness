"use client";

import { useEffect } from "react";
import type { Agent, ChatMessage } from "@/lib/types";
import { MessageComposer } from "../MessageComposer/MessageComposer";
import { StatusPill } from "../StatusPill/StatusPill";
import styles from "./ChatPanel.module.css";

interface Props { agent: Agent; messages: ChatMessage[]; focusId?: string; onSend: (body: string) => Promise<void>; }

export function ChatPanel({ agent, messages, focusId, onSend }: Props) {
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
        {messages.length ? messages.map((message) => <Bubble key={message.id} message={message} agent={agent.id} focused={message.id === focusId} />) : <div className={styles.empty}>No messages yet</div>}
      </div>
      <div className={styles.composer}><MessageComposer agent={agent.id} onSend={onSend} /></div>
    </div>
  );
}

function Bubble({ message, agent, focused }: { message: ChatMessage; agent: string; focused: boolean }) {
  const own = message.direction === "outgoing";
  return (
    <article tabIndex={-1} data-chat-id={message.id} className={`${styles.message} ${own ? styles.own : ""} ${focused ? styles.focused : ""}`}>
      <div className={styles.meta}>
        <strong>{own ? agent : message.sender}</strong>
        <span>{own ? `to ${message.recipient}` : `to ${agent}`}</span>
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
