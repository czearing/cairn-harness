import { existsSync } from "node:fs";
import path from "node:path";
import type { ChatMessage } from "@/lib/types";
import { sessionEventFile, sessionFiles, sessionTimeRange } from "./session-event-files.ts";
import { normalizeSessionEventTimestamp } from "./session-event-projector.ts";
import { readSession } from "./session-event-reader.ts";
import { defaultSessionIo, SessionStateCache, type SessionIo } from "./session-event-state.ts";

const defaultCacheLimit = 128;
const sessions = new SessionStateCache(defaultCacheLimit);

export function readRecentSessionEvents(root: string, agent: string, before: string | undefined, limit: number) {
  return readRecentWith(root, agent, before, limit, defaultSessionIo, sessions);
}

export function createSessionEventReader(overrides: Partial<SessionIo>, cacheLimit?: number) {
  const io = { ...defaultSessionIo, ...overrides };
  const cache = cacheLimit === undefined ? sessions : new SessionStateCache(cacheLimit);
  return {
    readRecentSessionEvents(root: string, agent: string, before: string | undefined, limit: number) {
      return readRecentWith(root, agent, before, limit, io, cache);
    },
    get cacheSize() { return cache.size; },
  };
}

function readRecentWith(root: string, agent: string, before: string | undefined, limit: number, io: SessionIo, cache: SessionStateCache) {
  const items: ChatMessage[] = [];
  let hasMore = false;
  for (const entry of sessionFiles(root, agent)) {
    for (const message of readSession(root, entry.file, agent, entry.sessionId, io, cache)) {
      if (!before || cursor(message) < before) {
        if (items.length >= limit) hasMore = true;
        keepLatest(items, message, limit);
      }
    }
  }
  return { items, hasMore };
}

export function resolveFocusedSessionEvent(root: string, agent: string, focusId: string) {
  const match = /^event:([^:]+):(\d+)$/.exec(focusId);
  if (!match || path.basename(match[1]) !== match[1]) return undefined;
  const file = sessionEventFile(root, agent, match[1]);
  if (!existsSync(file)) return undefined;
  return readSession(root, file, agent, match[1], defaultSessionIo, sessions)
    .find((message) => message.id === focusId);
}

export function readSessionEventWindow(root: string, agent: string, anchor: string, beforeLimit: number, afterLimit: number) {
  const before: ChatMessage[] = [];
  const after: ChatMessage[] = [];
  const equal: ChatMessage[] = [];
  const add = (message: ChatMessage) => {
    const value = cursor(message);
    if (value < anchor) keepLatest(before, message, beforeLimit);
    else if (value > anchor) keepEarliest(after, message, afterLimit);
    else equal.push(message);
  };
  const timestamp = anchor.slice(0, anchor.indexOf("\u0000"));
  const sources = sessionFiles(root, agent)
    .map((entry) => ({ ...entry, range: sessionTimeRange(entry.file) }))
    .filter((entry): entry is typeof entry & { range: { first: string; last: string } } => Boolean(entry.range));
  const visited = new Set<string>();
  const project = (entry: (typeof sources)[number]) => {
    if (visited.has(entry.file)) return;
    visited.add(entry.file);
    readSession(root, entry.file, agent, entry.sessionId, defaultSessionIo, sessions).forEach(add);
  };
  sources.filter((entry) => entry.range.first <= timestamp && entry.range.last >= timestamp).forEach(project);
  if (beforeLimit) {
    const earlier = sources.filter((entry) => entry.range.last < timestamp).sort((a, b) => b.range.last.localeCompare(a.range.last));
    for (const entry of earlier) {
      if (before.length >= beforeLimit && entry.range.last < before[0].timestamp) break;
      project(entry);
    }
  }
  if (afterLimit) {
    const later = sources.filter((entry) => entry.range.first > timestamp).sort((a, b) => a.range.first.localeCompare(b.range.first));
    for (const entry of later) {
      if (after.length >= afterLimit && entry.range.first > after[after.length - 1].timestamp) break;
      project(entry);
    }
  }
  return [...before, ...equal, ...after].sort(compareMessages);
}

export { normalizeSessionEventTimestamp };

function cursor(message: ChatMessage) { return `${message.timestamp}\u0000${message.id}`; }
function compareMessages(a: ChatMessage, b: ChatMessage) {
  const left = cursor(a);
  const right = cursor(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
function keepLatest(messages: ChatMessage[], message: ChatMessage, limit: number) {
  if (!limit) return;
  messages.push(message);
  messages.sort(compareMessages);
  if (messages.length > limit) messages.shift();
}
function keepEarliest(messages: ChatMessage[], message: ChatMessage, limit: number) {
  if (!limit) return;
  messages.push(message);
  messages.sort(compareMessages);
  if (messages.length > limit) messages.pop();
}
