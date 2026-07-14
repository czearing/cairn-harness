"use client";

import useSWRInfinite from "swr/infinite";
import type { ChatMessage, ConversationPage } from "./types";

const fetcher = (url: string) => fetch(url).then((response) => {
  if (!response.ok) throw new Error("Could not load conversation");
  return response.json() as Promise<ConversationPage>;
});

export function useConversation(projectId: string, agentId: string, focusId?: string) {
  function getKey(page: number, previous?: ConversationPage) {
    if (page > 0 && !previous?.hasMore) return null;
    const query = new URLSearchParams({ agent: agentId });
    if (page === 0 && focusId) query.set("focus", focusId);
    if (page > 0 && previous?.nextBefore) query.set("before", previous.nextBefore);
    return `/api/projects/${projectId}/messages?${query}`;
  }
  const { data, error, isLoading, isValidating, setSize, mutate } = useSWRInfinite(getKey, fetcher, {
    revalidateFirstPage: true,
    revalidateAll: false,
  });
  const pages = data || [];
  const messages = mergePages(pages);
  const olderCount = pages.slice(1).reduce((total, page) => total + page.items.length, 0);
  function loadOlder() {
    if (pages.at(-1)?.hasMore && !isValidating) void setSize((size) => size + 1);
  }
  return { messages, olderCount, hasMore: Boolean(pages.at(-1)?.hasMore), isLoading, isValidating, error, loadOlder, mutate };
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
