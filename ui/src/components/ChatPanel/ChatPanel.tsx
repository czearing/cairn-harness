"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { Agent, ChatMessage } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { MessageBody } from "../MessageBody/MessageBody";
import { MessageComposer } from "../MessageComposer/MessageComposer";
import { StatusPill } from "../StatusPill/StatusPill";
import { formatTime, normalize, scrollBottom } from "./chat-utils";
import styles from "./ChatPanel.module.css";

interface Props {
  agent: Agent; messages: ChatMessage[]; colors?: Record<string, string>; avatars?: Record<string, string>; focusId?: string;
  hasMore?: boolean; loading?: boolean; loadingMore?: boolean; olderCount?: number;
  onLoadOlder?: () => void; onSend: (body: string) => Promise<void>;
}

export function ChatPanel({ agent, messages, colors = {}, avatars = {}, focusId, hasMore, loading, loadingMore, olderCount = 0, onLoadOlder, onSend }: Props) {
  const list = useRef<VirtuosoHandle>(null);
  const [settled, setSettled] = useState(Boolean(focusId));
  const scroller = useRef<HTMLElement | Window | null>(null);
  const revealTimer = useRef<number | undefined>(undefined);
  const settleTimer = useRef<number | undefined>(undefined);
  const revealed = useRef(Boolean(focusId));
  const didInitialScroll = useRef(false);
  const settlingInitialBottom = useRef(!focusId);
  const reachedInitialBottom = useRef(false);
  const stickToBottom = useRef(!focusId);
  const focusedTarget = useRef<string | undefined>(undefined);
  const firstIndex = 1_000_000 - olderCount;
  const focusIndex = focusId ? messages.findIndex((message) => message.id === focusId) : -1;
  const hasMessages = messages.length > 0;
  const distinctRole = normalize(agent.role) !== normalize(agent.id);
  useEffect(() => {
    if (!focusId || focusedTarget.current === focusId) return;
    if (focusIndex < 0) return;
    focusedTarget.current = focusId;
    list.current?.scrollToIndex({ index: focusIndex, align: "center" });
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [firstIndex, focusId, focusIndex]);
  useEffect(() => {
    if (focusId || didInitialScroll.current || !hasMessages) return;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    let element: HTMLElement | undefined;
    let release = () => undefined;
    const attach = () => {
      element = scroller.current instanceof HTMLElement ? scroller.current : undefined;
      if (!element) {
        frame = requestAnimationFrame(attach);
        return;
      }
      didInitialScroll.current = true;
      start(element);
    };
    const start = (history: HTMLElement) => {
    settlingInitialBottom.current = true;
    const pin = () => {
      list.current?.scrollToIndex({ index: "LAST", align: "end" });
      history.scrollTop = history.scrollHeight;
    };
    observer = new ResizeObserver(() => {
      pin();
      if (!revealed.current) {
        revealed.current = true;
        revealTimer.current = window.setTimeout(() => setSettled(true), 60);
      }
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        settlingInitialBottom.current = false;
        reachedInitialBottom.current = true;
        observer?.disconnect();
      }, 300);
    });
    observer.observe(history);
    if (history.firstElementChild) observer.observe(history.firstElementChild);
    release = () => {
      if (!settlingInitialBottom.current) stickToBottom.current = false;
    };
    history.addEventListener("wheel", release, { passive: true });
    history.addEventListener("touchstart", release, { passive: true });
    history.addEventListener("pointerdown", release, { passive: true });
    pin();
    revealTimer.current = window.setTimeout(() => {
      revealed.current = true;
      setSettled(true);
    }, 250);
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      element?.removeEventListener("wheel", release);
      element?.removeEventListener("touchstart", release);
      element?.removeEventListener("pointerdown", release);
    };
  }, [agent.id, focusId, hasMessages]);
  useEffect(() => () => {
    window.clearTimeout(revealTimer.current);
    window.clearTimeout(settleTimer.current);
  }, []);
  useEffect(() => {
    if (focusId && focusIndex < 0 && hasMore && !loadingMore) onLoadOlder?.();
  }, [focusId, focusIndex, hasMore, loadingMore, onLoadOlder]);
  function itemContent(_index: number, message: ChatMessage) {
    return (
    <div className={`${styles.row} ${isUser(message) ? styles.rowOwn : ""}`}>
      <Bubble message={message} colors={colors} avatar={avatars[message.sender]} focused={message.id === focusId} />
    </div>
    );
  }
  return (
    <div className={styles.panel}>
      <header><div><h3>{agent.id}</h3>{distinctRole && <p>{agent.role}</p>}</div><StatusPill status={agent.status} /></header>
      {loading && !messages.length ? <div className={styles.empty}>Loading conversation</div> :
        <Virtuoso
          ref={list}
          className={`${styles.history} ${!settled ? styles.settling : ""}`}
          aria-label={`Conversation history with ${agent.id}`}
          data={messages}
          scrollerRef={(element) => { scroller.current = element; }}
          computeItemKey={(_index, message) => message.id}
          firstItemIndex={firstIndex}
          initialTopMostItemIndex={focusIndex >= 0 ? focusIndex : { index: "LAST", align: "end" }}
          alignToBottom={!focusId}
          followOutput={() => stickToBottom.current ? "auto" : false}
          totalListHeightChanged={() => {
            if (focusId || !stickToBottom.current || !messages.length) return;
            list.current?.scrollToIndex({ index: "LAST", align: "end" });
            scrollBottom(scroller.current);
            if (settlingInitialBottom.current) {
              window.clearTimeout(settleTimer.current);
              settleTimer.current = window.setTimeout(() => {
                settlingInitialBottom.current = false;
                reachedInitialBottom.current = true;
              }, 250);
            }
          }}
          atBottomStateChange={(atBottom) => {
            if (focusId) return;
            if (settlingInitialBottom.current) {
              if (!atBottom) scrollBottom(scroller.current);
              return;
            }
            if (atBottom) {
              reachedInitialBottom.current = true;
              stickToBottom.current = true;
            }
          }}
          startReached={() => hasMore && onLoadOlder?.()}
          itemContent={itemContent}
          components={{ Header: () => loadingMore && hasMore ? <div className={styles.loading}>Loading earlier messages</div> : null }}
        />}
      <div className={styles.composer}><MessageComposer agent={agent.id} onSend={onSend} /></div>
    </div>
  );
}

function Bubble({ message, colors, avatar, focused }: { message: ChatMessage; colors: Record<string, string>; avatar?: string; focused: boolean }) {
  if (message.kind === "tool") return <ToolBubble message={message} focused={focused} />;
  if (message.sender === "work-items" || message.sender === "todo-folder") {
    return <AssignmentBubble message={message} focused={focused} />;
  }
  const user = isUser(message);
  const sender = user ? "You" : message.sender;
  const identity = { "--sender-color": user ? "var(--accent)" : agentColor(message.sender, colors) } as CSSProperties;
  return (
    <article style={identity} tabIndex={-1} data-chat-id={message.id} className={`${styles.message} ${user ? styles.own : ""} ${message.kind !== "message" && message.kind !== "assistant" ? styles.event : ""} ${focused ? styles.focused : ""}`}>
      <div className={styles.meta}><span className={styles.avatar} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>{!avatar && sender.slice(0, 2).toUpperCase()}</span><strong>{sender}</strong><time>{formatTime(message.timestamp)}</time></div>
      <MessageBody message={message} />
    </article>
  );
}

function AssignmentBubble({ message, focused }: { message: ChatMessage; focused: boolean }) {
  return (
    <article tabIndex={-1} data-chat-id={message.id} className={`${styles.assignment} ${focused ? styles.focused : ""}`}>
      <div className={styles.assignmentMeta}><span>to {message.recipient}</span><time>{formatTime(message.timestamp)}</time></div>
      <MessageBody message={message} />
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
