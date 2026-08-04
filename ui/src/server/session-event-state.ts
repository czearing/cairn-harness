import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChatMessage } from "@/lib/types";

export interface SessionState {
  version: 2;
  offset: number;
  nextIndex: number;
  messages: ChatMessage[];
  tools: [string, string][];
  pending: [string, string][];
}

export interface SessionIo {
  mkdirSync: typeof mkdirSync;
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  statSync: typeof statSync;
  openSync: typeof openSync;
  readSync: typeof readSync;
  closeSync: typeof closeSync;
}

export const defaultSessionIo: SessionIo = {
  mkdirSync, readFileSync, writeFileSync, statSync, openSync, readSync, closeSync,
};

export class SessionStateCache {
  private readonly sessions = new Map<string, SessionState>();
  private readonly limit: number;
  constructor(limit: number) { this.limit = limit; }
  get(file: string) {
    const state = this.sessions.get(file);
    if (!state) return undefined;
    this.sessions.delete(file);
    this.sessions.set(file, state);
    return state;
  }
  set(file: string, state: SessionState) {
    if (this.limit <= 0) return;
    this.sessions.delete(file);
    this.sessions.set(file, state);
    while (this.sessions.size > this.limit) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }
  get size() { return this.sessions.size; }
}

export function prepareCacheFile(root: string, agent: string, sessionId: string, io: SessionIo) {
  const directory = path.join(root, ".cairn-harness", "ui-session-cache", agent);
  try {
    io.mkdirSync(directory, { recursive: true });
    return path.join(directory, `${sessionId}.json`);
  } catch {
    return undefined;
  }
}

export function loadCache(file: string | undefined, io: SessionIo): SessionState | undefined {
  if (!file) return undefined;
  try {
    const value = JSON.parse(io.readFileSync(file, "utf8")) as unknown;
    return isSessionState(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveCache(file: string | undefined, state: SessionState, io: SessionIo) {
  if (!file) return;
  try { io.writeFileSync(file, JSON.stringify(state)); } catch {}
}

export function emptyState(): SessionState {
  return { version: 2, offset: 0, nextIndex: 0, messages: [], tools: [], pending: [] };
}

function isSessionState(value: unknown): value is SessionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<SessionState>;
  return state.version === 2
    && nonnegativeInteger(state.offset) && nonnegativeInteger(state.nextIndex)
    && Array.isArray(state.messages) && state.messages.every(isChatMessage)
    && stringEntries(state.tools) && stringEntries(state.pending);
}
function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Partial<ChatMessage>;
  return strings(message.id, message.sender, message.recipient, message.body, message.status, message.timestamp)
    && (message.direction === "incoming" || message.direction === "outgoing")
    && ["message", "assistant", "tool", "session", "turn"].includes(String(message.kind))
    && (message.title === undefined || typeof message.title === "string");
}
function stringEntries(value: unknown): value is [string, string][] {
  return Array.isArray(value) && value.every((entry) =>
    Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "string");
}
function nonnegativeInteger(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0; }
function strings(...values: unknown[]) { return values.every((value) => typeof value === "string"); }
