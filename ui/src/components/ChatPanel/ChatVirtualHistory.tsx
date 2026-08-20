"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChatMessage } from "@/lib/types";
import { sameToolRun } from "./ChatMessageView";
import styles from "./ChatPanel.module.css";

const footerEstimate = 72;
// Larger than any achievable transcript height (3k messages capped at 1.2k px each is ~3.6M),
// while staying far inside safe float arithmetic.
const endOffsetSentinel = 1e9;

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

export function ChatVirtualHistory(props: Props) {
  // The virtualizer reads initialOffset once, when it is constructed. Constructing it before
  // the first page exists means that read happens against an empty list, so the first computed
  // range is index 0 and the conversation paints its OLDEST messages for a frame before
  // correcting. Mounting only once there are messages is what lets the first painted frame
  // already be the latest message. The key restarts that for each conversation.
  if (!props.messages.length) {
    return <div
      className={`${styles.history} ${styles.virtualizedHistory}`}
      role="log"
      tabIndex={0}
      aria-label={`Conversation history with ${props.agentId}`}
    >
      <div className={styles.empty}>{props.loading ? "Loading conversation" : ""}</div>
    </div>;
  }
  return <VirtualHistory key={props.agentId} {...props} />;
}

function VirtualHistory({
  agentId, messages, loadingMore, hasMore, onLoadOlder, renderItem, footer,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const loadingOlder = useRef(false);
  const hasFooter = Boolean(footer);
  const count = messages.length + (hasFooter ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewport.current,
    estimateSize: (index) => index < messages.length ? estimate(messages, index) : footerEstimate,
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
    // Start the very first computed range at the end instead of index 0. calculateRangeImpl
    // resolves the offset with a binary search bounded by the last index, so an offset past
    // the end deterministically clamps to the final items instead of producing an empty or
    // leading range. Summing the size estimates is not enough: they undershoot real rows, so
    // whether the sum landed at the end depended on page size. A sentinel far beyond any real
    // transcript always clamps, and the layout-effect scrollToEnd sets the exact offset.
    initialOffset: () => endOffsetSentinel,
  });
  // Start each conversation at the latest message, as the TanStack chat guide prescribes.
  useLayoutEffect(() => {
    virtualizer.scrollToEnd({ behavior: "auto" });
  }, [virtualizer]);
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
    </div>
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
