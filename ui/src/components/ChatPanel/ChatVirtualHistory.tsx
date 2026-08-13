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
  const following = useRef(true);
  const loadingOlder = useRef(false);
  const hasFooter = Boolean(footer);
  const count = messages.length + (hasFooter ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewport.current,
    estimateSize: (index) => index < messages.length ? estimate(messages, index) : 72,
    getItemKey: (index) => index < messages.length ? messages[index].id : "conversation-footer",
    overscan: 14,
    anchorTo: "end",
    followOnAppend: "auto",
    useAnimationFrameWithResizeObserver: true,
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.start < (instance.scrollOffset ?? 0);
  useLayoutEffect(() => {
    following.current = true;
    virtualizer.scrollToEnd({ behavior: "auto" });
  }, [agentId, virtualizer]);
  // `anchorTo: "end"` is the single authority for staying pinned while the streaming footer grows.
  // A second observer writing scrollTop directly fought it and produced the visible jitter.
  const lastMessageId = messages.at(-1)?.id;
  useEffect(() => {
    if (following.current) virtualizer.scrollToEnd({ behavior: "auto" });
  }, [lastMessageId, hasFooter, virtualizer]);
  useEffect(() => {
    if (!loadingMore) loadingOlder.current = false;
  }, [loadingMore]);
  function onScroll() {
    const element = viewport.current;
    if (!element) return;
    const gap = element.scrollHeight - element.clientHeight - element.scrollTop;
    if (gap <= 2) following.current = true;
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
    onWheel={(event) => { if (event.deltaY < 0) following.current = false; }}
    onPointerDown={(event) => { if (event.target === event.currentTarget) following.current = false; }}
    onTouchStart={() => { following.current = false; }}
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
    if (sameToolRun(message, messages[index + 1])) return 1;
    let start = index;
    while (start > 0 && sameToolRun(messages[start - 1], message)) start -= 1;
    const run = messages.slice(start, index + 1);
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
