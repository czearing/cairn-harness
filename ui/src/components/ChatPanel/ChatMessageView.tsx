"use client";

import { Button } from "@/components/Button/Button";

import { useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { messageDeliveryState } from "@/lib/message-lifecycle";
import { MessageBody } from "../MessageBody/MessageBody";
import { StatusIndicator, type StatusKind } from "../StatusIndicator/StatusIndicator";
import { chatMessageStatus, exactTime, formatTime } from "./chat-utils";
import styles from "./ChatPanel.module.css";

interface BubbleProps {
  message: ChatMessage;
  tools?: ChatMessage[];
  group: "single" | "start" | "middle" | "end";
  displaySender: string;
  color: string;
  avatar?: string;
  focused: boolean;
  onRetry?: (body: string, submissionId: string) => Promise<void>;
}

export function ChatBubble({ message, tools, group, displaySender, color, avatar, focused, onRetry }: BubbleProps) {
  if (tools) return <ToolGroup messages={tools} focused={focused} />;
  if (message.sender === "work-items" || message.sender === "todo-folder") {
    return <AssignmentBubble message={message} focused={focused} />;
  }
  const user = isUser(message);
  const sender = user ? "You" : displaySender;
  const live = Boolean(message.live);
  const identity = { "--sender-color": user ? "var(--accent)" : color } as CSSProperties;
  const event = message.kind !== "message" && message.kind !== "assistant";
  return (
    <article style={identity} tabIndex={-1} data-chat-id={message.id} aria-busy={live || undefined} aria-label={`${live ? "Live response" : event ? eventLabel(message) : "Message"} from ${sender}, ${exactTime(message.timestamp)}, ${message.kind}, ${chatMessageStatus(message)}`} className={`${styles.message} ${user ? styles.own : ""} ${event ? styles.event : ""} ${live ? styles.live : ""} ${styles[group]} ${focused ? styles.focused : ""}`}>
      {((!user && (group === "single" || group === "start")) || event) && <div className={styles.meta}><span className={styles.avatar} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>{!avatar && sender.slice(0, 2).toUpperCase()}</span><strong>{sender}</strong>{live && <StatusIndicator status="active" label="Live" size="compact" />}{event && <span className={styles.eventLabel}>{eventLabel(message)}</span>}<Timestamp value={message.timestamp} /></div>}
      {user && (group === "single" || group === "start") && <div className={styles.ownTime}><Timestamp value={message.timestamp} /></div>}
      <MessageBody message={message} />
      {user && (group === "single" || group === "end") && <MessageProgress message={message} onRetry={onRetry} />}
    </article>
  );
}

export function ActiveResponse({ title }: { title: string }) {
  return <div className={styles.working}><StatusIndicator status="working" label={`${title} is responding`} announce /></div>;
}

export function HistoryError({ message, stale = false, retrying, onRetry }: { message: string; stale?: boolean; retrying?: boolean; onRetry?: () => void }) {
  return <div className={stale ? styles.historyBanner : styles.initialHistoryError} role="alert">
    <span>{message}</span>
    <Button variant="secondary" size="compact" disabled={retrying} onClick={onRetry}>{retrying ? "Retrying…" : "Retry"}</Button>
  </div>;
}

function Timestamp({ value }: { value: string }) {
  const [exact, setExact] = useState(false);
  return <Button variant="inherit" type="button" className={styles.timestamp} aria-label={`Sent ${exactTime(value)}`} onClick={() => setExact((visible) => !visible)}><time dateTime={value}>{exact ? exactTime(value) : formatTime(value)}</time></Button>;
}

function MessageProgress({ message, onRetry }: { message: ChatMessage; onRetry?: (body: string, submissionId: string) => Promise<void> }) {
  const state = messageDeliveryState(message);
  if (state === "failed") return <div className={`${styles.progress} ${styles.failed}`}>
    <StatusIndicator status="failed" size="compact" />
    <span>{message.error || message.status || "This message was not delivered."}</span>
    {message.submissionId && <><span> · </span><Button variant="link" onClick={async (event) => {
      const bubbleId = event.currentTarget.closest<HTMLElement>("article")?.dataset.chatId;
      await onRetry?.(message.body, message.submissionId!);
      requestAnimationFrame(() => {
        if (bubbleId) document.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(bubbleId)}"]`)?.focus();
      });
    }}><RotateCcw size={13} aria-hidden="true" />Retry</Button></>}
  </div>;
  return state ? <div className={styles.progress}>
    <StatusIndicator status={deliveryStatus(state)} label={chatMessageStatus(message)} size="compact" announce={state === "sending"} />
  </div> : null;
}

function AssignmentBubble({ message, focused }: { message: ChatMessage; focused: boolean }) {
  return <article tabIndex={-1} data-chat-id={message.id} aria-label={`System event for ${message.recipient}, ${exactTime(message.timestamp)}, ${message.kind}, ${message.status}`} className={`${styles.assignment} ${focused ? styles.focused : ""}`}>
    <div className={styles.assignmentMeta}><strong>System event</strong><span>to {message.recipient}</span><Timestamp value={message.timestamp} /></div>
    <MessageBody message={message} />
  </article>;
}

function ToolGroup({ messages, focused }: { messages: ChatMessage[]; focused: boolean }) {
  const active = messages.some((message) => message.status === "working");
  return <article tabIndex={-1} aria-label={`Tools used by ${messages[0].sender}, ${exactTime(messages.at(-1)?.timestamp || "")}, tool, ${messages.some(toolFailed) ? "failed" : "completed"}`} className={`${styles.toolGroup} ${focused ? styles.focused : ""}`}>
    {messages.map((message) => <span key={message.id} data-chat-id={message.id} className={styles.toolAnchor} />)}
    <details open={active || undefined}><summary><span>{active ? "Current activity" : "Tools used"} ({messages.length})</span><Timestamp value={messages.at(-1)?.timestamp || ""} /></summary>
      <div className={styles.toolList}>{messages.map((message) => {
        const failed = toolFailed(message);
        return <section key={message.id} className={failed ? styles.toolFailed : undefined}>
          <div className={styles.toolMeta}><strong>{toolName(message)}</strong><StatusIndicator status={failed ? "failed" : toolState(message) === "Working" ? "working" : "completed"} label={message.activity?.phase || (failed ? "Failed" : toolState(message))} size="compact" /><Timestamp value={message.timestamp} /></div>
          <MessageBody message={message} collapsibleTool={false} compact />
        </section>;
      })}</div>
    </details>
  </article>;
}

export function toolRun(messages: ChatMessage[], end: number) {
  let start = end;
  while (start > 0 && sameToolRun(messages[start - 1], messages[start])) start -= 1;
  return messages.slice(start, end + 1);
}
export function toolRunEnd(messages: ChatMessage[], start: number) {
  let end = start;
  while (end + 1 < messages.length && sameToolRun(messages[end], messages[end + 1])) end += 1;
  return end;
}
export function sameToolRun(left?: ChatMessage, right?: ChatMessage) {
  return left?.kind === "tool" && right?.kind === "tool" && left.sender === right.sender;
}
export function isUser(message: ChatMessage) { return message.sender === "dashboard" || message.sender === "human"; }
function toolFailed(message: ChatMessage) { return /(fail|error|cancel)/i.test(message.status); }
function toolState(message: ChatMessage) { return /^Using\b/i.test(message.title || "") ? "Working" : "Completed"; }
function deliveryStatus(state: NonNullable<ReturnType<typeof messageDeliveryState>>): StatusKind {
  const statuses: Record<NonNullable<ReturnType<typeof messageDeliveryState>>, StatusKind> = {
    sending: "sending",
    queued: "queued",
    delivered: "delivered",
    working: "working",
    replied: "replied",
    failed: "failed",
  };
  return statuses[state];
}
function toolName(message: ChatMessage) {
  const value = (message.title || message.recipient || "Tool").replace(/^(Using|Used)\s+/i, "").trim();
  return value ? value[0].toUpperCase() + value.slice(1) : "Tool";
}
function eventLabel(message: ChatMessage) {
  if (message.kind === "turn") return "Agent result";
  if (message.kind === "session") return "Session event";
  return "Agent update";
}
