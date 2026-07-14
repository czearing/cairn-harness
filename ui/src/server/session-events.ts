import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChatMessage } from "@/lib/types";

interface SessionEvent { type?: string; timestamp?: string | number; data?: Record<string, unknown>; }
interface SessionState {
  offset: number;
  nextIndex: number;
  messages: ChatMessage[];
  tools: [string, string][];
  pending: [string, string][];
}

const sessions = new Map<string, SessionState>();

export function readSessionEvents(root: string, agent: string): ChatMessage[] {
  return sessionFiles(root, agent)
    .flatMap((entry) => readSession(root, entry.file, agent, entry.sessionId))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function readRecentSessionEvents(root: string, agent: string, before: string | undefined, limit: number) {
  const items: ChatMessage[] = [];
  let hasMore = false;
  const files = sessionFiles(root, agent);
  for (let index = 0; index < files.length; index++) {
    const entry = files[index];
    const eligible = readSession(root, entry.file, agent, entry.sessionId)
      .filter((message) => !before || cursor(message) < before);
    const remaining = limit - items.length;
    const page = eligible.slice(-remaining);
    items.push(...page);
    hasMore ||= eligible.length > page.length;
    if (items.length >= limit) {
      hasMore ||= index < files.length - 1;
      break;
    }
  }
  return { items: items.sort((a, b) => a.timestamp.localeCompare(b.timestamp)), hasMore };
}

function sessionFiles(root: string, agent: string) {
  const directory = path.join(root, ".cairn-harness", "copilot-home", agent, "session-state");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(directory, entry.name, "events.jsonl");
      return { file, sessionId: entry.name, modified: existsSync(file) ? statSync(file).mtimeMs : 0 };
    })
    .filter((entry) => entry.modified)
    .sort((a, b) => b.modified - a.modified);
}

function readSession(root: string, file: string, agent: string, sessionId: string) {
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  let state = sessions.get(file) || loadCache(cachePath(root, agent, sessionId));
  if (!state || state.offset > size) state = emptyState();
  if (state.offset < size) {
    appendEvents(state, readCompleteLines(file, state.offset), agent, sessionId);
    sessions.set(file, state);
    writeFileSync(cachePath(root, agent, sessionId), JSON.stringify(state));
  } else {
    sessions.set(file, state);
  }
  return state.messages;
}

function appendEvents(state: SessionState, chunk: { text: string; offset: number }, agent: string, sessionId: string) {
  const tools = new Map(state.tools);
  const pending = new Map(state.pending);
  for (const line of chunk.text.split("\n")) {
    if (!line) continue;
    const event = parseLine(line);
    const index = state.nextIndex++;
    if (!event) continue;
    const data = event.data || {};
    const timestamp = eventTime(event.timestamp);
    if (event.type === "assistant.message") {
      const content = String(data.content || "");
      if (content && !content.includes("HARNESS_SESSION_READY") && !content.includes("CAIRN_ENVELOPE_BEGIN")) {
        state.messages.push(item(sessionId, index, agent, "team", content, timestamp, "assistant", "Response"));
      }
    } else if (event.type === "tool.execution_start" && data.toolCallId) {
      const id = String(data.toolCallId);
      const name = String(data.toolName || "tool");
      const message = item(sessionId, index, agent, name, pretty(data.arguments), timestamp, "tool", `Using ${toolLabel(name)}`);
      tools.set(id, name);
      pending.set(id, message.id);
      state.messages.push(message);
    } else if (event.type === "tool.execution_complete" && data.toolCallId) {
      const id = String(data.toolCallId);
      const name = tools.get(id) || "tool";
      const pendingId = pending.get(id);
      if (pendingId) state.messages = state.messages.filter((message) => message.id !== pendingId);
      pending.delete(id);
      state.messages.push(item(sessionId, index, agent, name, pretty(toolResult(data.result, data.success)), timestamp, "tool", `Used ${toolLabel(name)}`));
    }
  }
  state.offset = chunk.offset;
  state.tools = [...tools];
  state.pending = [...pending];
}

function readCompleteLines(file: string, offset: number) {
  const size = statSync(file).size;
  const buffer = Buffer.alloc(size - offset);
  const descriptor = openSync(file, "r");
  try { readSync(descriptor, buffer, 0, buffer.length, offset); } finally { closeSync(descriptor); }
  const end = buffer.lastIndexOf(10);
  if (end < 0) return { text: "", offset };
  return { text: buffer.subarray(0, end + 1).toString("utf8"), offset: offset + end + 1 };
}

function cachePath(root: string, agent: string, sessionId: string) {
  const directory = path.join(root, ".cairn-harness", "ui-session-cache", agent);
  mkdirSync(directory, { recursive: true });
  return path.join(directory, `${sessionId}.json`);
}
function loadCache(file: string): SessionState | undefined {
  try { return JSON.parse(readFileSync(file, "utf8")) as SessionState; } catch { return undefined; }
}
function emptyState(): SessionState {
  return { offset: 0, nextIndex: 0, messages: [], tools: [], pending: [] };
}
function parseLine(line: string): SessionEvent | undefined {
  try { return JSON.parse(line) as SessionEvent; } catch { return undefined; }
}
function item(sessionId: string, index: number, sender: string, recipient: string, body: string, timestamp: string, kind: ChatMessage["kind"], title: string): ChatMessage {
  return { id: `event:${sessionId}:${index}`, sender, recipient, body, status: "recorded", timestamp, direction: sender === "dashboard" ? "incoming" : "outgoing", kind, title };
}
function pretty(value: unknown) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value || ""); }
}
function toolResult(result: unknown, success: unknown) {
  if (result && typeof result === "object" && "content" in result) return String((result as { content?: unknown }).content || success || "");
  return result || success;
}
function toolLabel(name: string) {
  const cleaned = name.replace(/^(cairnlearn|cairn)-/, "").replace(/[_-]+/g, " ").trim();
  return cleaned === "skill output" ? "skill review" : cleaned || "tool";
}
function eventTime(value: string | number | undefined) {
  return typeof value === "number" ? new Date(value).toISOString() : value || "";
}
function cursor(message: ChatMessage) {
  return `${message.timestamp}\u0000${message.id}`;
}
