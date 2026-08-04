"use client";

import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import type { ChatMessage, ConversationPage } from "./types";
import { ConversationPrefetchCache, InFlightRequests, isConversationFirstPage } from "./conversation-prefetch-cache";
import { reconcileOptimisticMessages } from "./conversation-reconciliation";

const fetcher = (url: string) => fetch(url).then((response) => {
  if (!response.ok) throw new Error("Could not load conversation");
  return response.json() as Promise<ConversationPage>;
});
const firstPages = new ConversationPrefetchCache<ConversationPage>();
const pendingPages = new InFlightRequests<ConversationPage>();
const optimisticMessages = new Map<string, ChatMessage[]>();
const CONVERSATION_SCROLLBACK_LIMIT = 20_000;
const FOCUSED_CONVERSATION_PAGE_LIMIT = 100;

export function prefetchConversation(projectId: string, agentId: string) {
  const url = firstPageUrl(projectId, agentId);
  if (firstPages.get(url) || pendingPages.has(url)) return;
  void sharedFetch(url).then((page) => firstPages.set(url, page));
}

export function useConversation(projectId: string, agentId: string, focusId?: string) {
  const firstUrl = firstPageUrl(projectId, agentId, focusId);
  const latestUrl = firstPageUrl(projectId, agentId);
  const [, setOptimisticVersion] = useState(0);
  function getKey(page: number, previous?: ConversationPage) {
    if (!focusId && page > 0) return null;
    if (page > 0 && !previous?.hasMore) return null;
    const query = new URLSearchParams({
      agent: agentId,
      limit: String(focusId ? FOCUSED_CONVERSATION_PAGE_LIMIT : CONVERSATION_SCROLLBACK_LIMIT),
    });
    if (page === 0 && focusId) query.set("focus", focusId);
    if (page > 0 && previous?.nextBefore) query.set("before", previous.nextBefore);
    return `/api/projects/${projectId}/messages?${query}`;
  }
  const cached = firstPages.get(firstUrl);
  const { data, error, isValidating, setSize, mutate } = useSWRInfinite(getKey, sharedFetch, {
    fallbackData: cached ? [cached] : undefined,
    revalidateFirstPage: true,
    revalidateAll: false,
    onSuccess: (pages) => {
      if (pages[0]) firstPages.set(firstUrl, pages[0]);
      reconcileStoredOptimistic(latestUrl, mergePages(pages));
    },
  });
  const pages = data || (cached ? [cached] : []);
  const serverMessages = mergePages(pages);
  const messages = reconcileOptimisticMessages(serverMessages, optimisticMessages.get(latestUrl) || []).messages;
  const groupBreakIds = pages.slice(0, -1).map((page) => page.items[0]?.id).filter((id): id is string => Boolean(id));
  const olderCount = pages.slice(1).reduce((total, page) => total + page.items.length, 0);
  function loadOlder() {
    if (focusId && pages.at(-1)?.hasMore && !isValidating) void setSize((size) => size + 1);
  }
  function refreshLatest() {
    return mutate((current) => current, {
      revalidate: (_page, key) => isConversationFirstPage(String(key)),
    });
  }
  function upsertLatest(message: ChatMessage) {
    const current = optimisticMessages.get(latestUrl) || [];
    optimisticMessages.set(latestUrl, [...current.filter((item) => !sameSubmission(item, message)), message].slice(-20));
    setOptimisticVersion((version) => version + 1);
    return Promise.resolve();
  }

  return { messages, groupBreakIds, olderCount, hasMore: Boolean(focusId && pages.at(-1)?.hasMore), isLoading: pages.length === 0 && !error, isValidating, error, loadOlder, mutate, refreshLatest, upsertLatest };
}

function sharedFetch(url: string) {
  return pendingPages.run(url, () => fetcher(url));
}

function firstPageUrl(projectId: string, agentId: string, focusId?: string) {
  const query = new URLSearchParams({
    agent: agentId,
    limit: String(focusId ? FOCUSED_CONVERSATION_PAGE_LIMIT : CONVERSATION_SCROLLBACK_LIMIT),
  });
  if (focusId) query.set("focus", focusId);
  return `/api/projects/${projectId}/messages?${query}`;
}

function mergePages(pages: ConversationPage[]) {
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];
  for (const page of [...pages].reverse()) {
    for (const message of page.items) {
      if (!seen.has(message.id)) {
        seen.add(message.id);
        messages.push(message);
      }
    }
  }
  return messages;
}

function sameSubmission(left: ChatMessage, right: ChatMessage) {
  return left.id === right.id || Boolean(left.submissionId && left.submissionId === right.submissionId);
}

function reconcileStoredOptimistic(key: string, serverMessages: ChatMessage[]) {
  const current = optimisticMessages.get(key);
  if (!current?.length) return;
  const { unresolved } = reconcileOptimisticMessages(serverMessages, current);
  if (unresolved.length) optimisticMessages.set(key, unresolved);
  else optimisticMessages.delete(key);
}
