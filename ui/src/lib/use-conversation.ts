"use client";

import useSWRInfinite from "swr/infinite";
import type { ChatMessage, ConversationPage } from "./types";

const fetcher = (url: string) => fetch(url).then((response) => {
  if (!response.ok) throw new Error("Could not load conversation");
  return response.json() as Promise<ConversationPage>;
});
const firstPages = new Map<string, ConversationPage>();

export function prefetchConversation(projectId: string, agentId: string) {
  const url = firstPageUrl(projectId, agentId);
  if (firstPages.has(url)) return;
  void fetcher(url).then((page) => firstPages.set(url, page));
}

export function useConversation(projectId: string, agentId: string, focusId?: string) {
  const firstUrl = firstPageUrl(projectId, agentId, focusId);
  function getKey(page: number, previous?: ConversationPage) {
    if (page > 0 && !previous?.hasMore) return null;
    const query = new URLSearchParams({ agent: agentId });
    if (page === 0 && focusId) query.set("focus", focusId);
    if (page > 0 && previous?.nextBefore) query.set("before", previous.nextBefore);
    return `/api/projects/${projectId}/messages?${query}`;
  }
  const cached = firstPages.get(firstUrl);
  const { data, error, isLoading, isValidating, setSize, mutate } = useSWRInfinite(getKey, fetcher, {
    fallbackData: cached ? [cached] : undefined,
    revalidateFirstPage: true,
    revalidateAll: false,
    onSuccess: (pages) => {
      if (pages[0]) firstPages.set(firstUrl, pages[0]);
    },
  });
  const pages = data || [];
  const messages = mergePages(pages);
  const olderCount = pages.slice(1).reduce((total, page) => total + page.items.length, 0);
  function loadOlder() {
    if (pages.at(-1)?.hasMore && !isValidating) void setSize((size) => size + 1);
  }

  return { messages, olderCount, hasMore: Boolean(pages.at(-1)?.hasMore), isLoading, isValidating, error, loadOlder, mutate };
}

function firstPageUrl(projectId: string, agentId: string, focusId?: string) {
  const query = new URLSearchParams({ agent: agentId });
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
