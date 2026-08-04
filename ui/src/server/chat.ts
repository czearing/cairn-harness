import type { DatabaseSync } from "node:sqlite";
import type { Agent, ChatMessage, ConversationPage } from "@/lib/types";
import { readRecentSessionEvents, readSessionEventWindow, resolveFocusedSessionEvent } from "./session-events";
import { hasDatabaseBefore, readDatabasePage, readDatabaseWindow, resolveDatabaseFocus } from "./chat-database.ts";
import { compareMessages, cursor, dedupe } from "./chat-order.ts";
import { readLiveResponse } from "./live-response.ts";

export function readConversationPage(db: DatabaseSync, root: string, agent: Agent, before?: string, focusId?: string, limit = 30): ConversationPage {
  if (focusId) {
    const focused = resolveDatabaseFocus(db, agent, focusId)
      || resolveFocusedSessionEvent(root, agent.id, focusId);
    if (focused) return readFocusedPage(db, root, agent, focused, limit);
  }
  const database = readDatabasePage(db, agent, before, limit);
  const session = readRecentSessionEvents(root, agent.id, before, limit);
  const live = before ? undefined : readLiveResponse(root, agent);
  const sessionItems = live ? suppressCurrentLiveSession(session.items, database.items, live) : session.items;
  const merged = dedupe([...database.items, ...sessionItems, ...(live ? [live] : [])].sort(compareMessages));
  const items = removeRedundantTurns(merged).slice(-limit);
  return {
    items,
    hasMore: database.hasMore || session.hasMore,
    nextBefore: items[0] ? cursor(items[0]) : undefined,
  };
}

function suppressCurrentLiveSession(session: ChatMessage[], database: ChatMessage[], live: ChatMessage) {
  const request = [...database].reverse().find((message) =>
    message.kind === "message" && message.sender === "dashboard" && message.timestamp <= live.timestamp);
  const sessionId = live.id.replace(/^live:[^:]+:/, "");
  return session.filter((message) => !(message.kind === "assistant"
    && message.sender === live.sender
    && message.id.startsWith(`event:${sessionId}:`)
    && message.timestamp >= (request?.timestamp || live.timestamp)));
}

function removeRedundantTurns(messages: ChatMessage[]) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return messages.filter((message) => {
    if (message.kind !== "turn" || !message.replyToId) return true;
    const request = byId.get(message.replyToId);
    if (!request) return true;
    return !messages.some((candidate) =>
      candidate.kind === "assistant"
      && candidate.sender === message.sender
      && candidate.timestamp >= request.timestamp
      && candidate.timestamp <= message.timestamp);
  });
}

function readFocusedPage(db: DatabaseSync, root: string, agent: Agent, focused: ChatMessage, limit: number): ConversationPage {
  const anchor = cursor(focused);
  const sideLimit = limit + 1;
  const database = readDatabaseWindow(db, agent, anchor, sideLimit);
  const session = readSessionEventWindow(root, agent.id, anchor, sideLimit, sideLimit);
  const merged = dedupe([...database, ...session, focused].sort(compareMessages), focused.id);
  const focus = merged.findIndex((message) => message.id === focused.id);
  if (focus < 0) return readConversationPage(db, root, agent, undefined, undefined, limit);
  const half = Math.floor(limit / 2);
  const start = Math.max(0, Math.min(focus - half, merged.length - limit));
  const items = merged.slice(start, start + limit);
  const nextBefore = items[0] ? cursor(items[0]) : undefined;
  return {
    items,
    hasMore: Boolean(nextBefore && (hasDatabaseBefore(db, agent, nextBefore)
      || readSessionEventWindow(root, agent.id, nextBefore, 1, 0)
        .some((message) => cursor(message) < nextBefore))),
    nextBefore,
  };
}
