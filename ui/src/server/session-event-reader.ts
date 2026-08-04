import { existsSync } from "node:fs";
import type { ChatMessage } from "@/lib/types";
import { appendEvents } from "./session-event-projector.ts";
import {
  defaultSessionIo, emptyState, loadCache, prepareCacheFile, saveCache,
  type SessionIo, type SessionState, SessionStateCache,
} from "./session-event-state.ts";

const readChunkSize = 64 * 1024;

export function readSession(root: string, file: string, agent: string, sessionId: string, io: SessionIo = defaultSessionIo, cacheStore: SessionStateCache) {
  if (!existsSync(file)) return [];
  const size = io.statSync(file).size;
  const cache = prepareCacheFile(root, agent, sessionId, io);
  let state = cacheStore.get(file) || loadCache(cache, io);
  if (!state || state.offset > size) state = emptyState();
  if (state.offset < size) {
    appendEventTail(state, file, size, agent, sessionId, io);
    cacheStore.set(file, state);
    saveCache(cache, state, io);
  } else {
    cacheStore.set(file, state);
  }
  return state.messages.filter(visibleMessage);
}

function appendEventTail(state: SessionState, file: string, size: number, agent: string, sessionId: string, io: SessionIo) {
  const buffer = Buffer.alloc(readChunkSize);
  const descriptor = io.openSync(file, "r");
  let position = state.offset;
  let carry: Buffer[] = [];
  let carryLength = 0;
  try {
    while (position < size) {
      const requested = Math.min(buffer.length, size - position);
      const bytesRead = io.readSync(descriptor, buffer, 0, requested, position);
      if (bytesRead <= 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      const end = chunk.lastIndexOf(10);
      if (end < 0) {
        const fragment = Buffer.from(chunk);
        carry.push(fragment);
        carryLength += fragment.length;
      } else {
        const complete = carryLength
          ? Buffer.concat([...carry, chunk.subarray(0, end + 1)], carryLength + end + 1)
          : chunk.subarray(0, end + 1);
        appendEvents(state, { text: complete.toString("utf8"), offset: position + end + 1 }, agent, sessionId);
        carry = [];
        carryLength = 0;
        if (end + 1 < bytesRead) {
          const fragment = Buffer.from(chunk.subarray(end + 1));
          carry.push(fragment);
          carryLength = fragment.length;
        }
      }
      position += bytesRead;
    }
  } finally {
    io.closeSync(descriptor);
  }
}

function visibleMessage(message: ChatMessage) {
  if (message.kind !== "tool") return true;
  return !["true", "false", "Query returned 0 rows.", '{"ok":true}', "{\n  \"ok\": true\n}"].includes(message.body);
}
