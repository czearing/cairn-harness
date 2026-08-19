"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChatMessage } from "@/lib/types";
import { sameToolRun } from "./ChatMessageView";
import styles from "./ChatPanel.module.css";

interface Props {
  agentId: string;
  messages: ChatMessage[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadOlder?: () => void;
  renderItem: (message: ChatMessage, index: number) => ReactNode;
  footer?: ReactNode;
}

export function ChatVirtualHistory({
  agentId, messages, loading, loadingMore, hasMore, onLoadOlder, renderItem, footer,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const pinnedAgent = useRef<string>(undefined);
  const loadingOlder = useRef(false);
  const hasFooter = Boolean(footer);
  const count = messages.length + (hasFooter ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewport.current,
    estimateSize: (index) => index < messages.length ? estimate(messages, index) : 72,
    getItemKey: (index) => index < messages.length ? messages[index].id : "conversation-footer",
    overscan: 14,
    // End anchoring is the single scroll authority, exactly as the TanStack chat guide
    // prescribes: it pins streaming growth, follows appends only when the reader is already
    // at the latest message, and holds the viewport steady while older history prepends.
    // Tracking "am I following?" by hand, calling scrollToEnd on every new message, or
    // overriding the size-change adjustment all fight it, and that fight was the jitter.
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    useAnimationFrameWithResizeObserver: true,
  });
  // Start each conversation at the latest message, once its first page actually exists.
  useLayoutEffect(() => {
    if (pinnedAgent.current === agentId || !count) return;
    pinnedAgent.current = agentId;
    virtualizer.scrollToEnd({ behavior: "auto" });
  }, [agentId, count, virtualizer]);
  useEffect(() => {
    if (!loadingMore) loadingOlder.current = false;
  }, [loadingMore]);
  function onScroll() {
    const element = viewport.current;
    if (!element) return;
    if (element.scrollTop <= 240 && hasMore && !loadingMore && !loadingOlder.current) {
      loadingOlder.current = true;
      onLoadOlder?.();
    }
  }
  return <div
    ref={viewport}
    className={`${styles.history} ${styles.virtualizedHistory}`}
    role="log"
    tabIndex={0}
    aria-label={`Conversation history with ${agentId}`}
    onScroll={onScroll}
  >
    {loading && !messages.length ? <div className={styles.empty}>Loading conversation</div> :
      <div className={styles.virtualSpace} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => <div
          key={item.key}
          ref={virtualizer.measureElement}
          data-index={item.index}
          className={styles.virtualRow}
          style={{ transform: `translateY(${item.start}px)` }}
        >
          {item.index < messages.length ? renderItem(messages[item.index], item.index) : footer}
        </div>)}
      </div>}
  </div>;
}

function estimate(messages: ChatMessage[], index: number) {
  const message = messages[index];
  if (message.kind === "tool") {
    if (sameToolRun(messages[index - 1], message)) return 1;
    let end = index;
    while (end + 1 < messages.length && sameToolRun(messages[end], messages[end + 1])) end += 1;
    const run = messages.slice(index, end + 1);
    if (!run.some((item) => item.status === "working")) return 58;
    return 58 + run.reduce((total, item) => total + 42 + bodyHeight(item.body), 0);
  }
  return Math.min(1_200, 52 + bodyHeight(message.body));
}

function bodyHeight(body: string) {
  const lines = body.split(/\r?\n/).reduce((total, line) =>
    total + Math.max(1, Math.ceil(line.length / 54)), 0);
  return lines * 19;
}
