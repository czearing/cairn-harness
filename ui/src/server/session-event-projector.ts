import type { ChatMessage } from "@/lib/types";
import { projectToolActivity } from "./session-activity.ts";
import type { SessionState } from "./session-event-state.ts";

export interface SessionEvent { type?: string; timestamp?: unknown; data?: Record<string, unknown>; }

export function appendEvents(state: SessionState, chunk: { text: string; offset: number }, agent: string, sessionId: string) {
  const tools = new Map(state.tools);
  const pending = new Map(state.pending);
  for (const line of chunk.text.split("\n")) {
    if (!line) continue;
    const event = parseSessionEvent(line);
    const index = state.nextIndex++;
    if (!event) continue;
    projectEvent(event, index, agent, sessionId, tools, pending,
      (message) => state.messages.push(message),
      (id) => { state.messages = state.messages.filter((message) => message.id !== id); });
  }
  state.offset = chunk.offset;
  state.tools = [...tools];
  state.pending = [...pending];
}

function projectEvent(event: SessionEvent, index: number, agent: string, sessionId: string, tools: Map<string, string>, pending: Map<string, string>, add: (message: ChatMessage) => void, remove: (id: string) => void) {
  const data = event.data || {};
  const timestamp = normalizeSessionEventTimestamp(event.timestamp);
  if (event.type === "assistant.message") {
    const content = String(data.content || "");
    if (content && !content.includes("HARNESS_SESSION_READY") && !content.includes("CAIRN_ENVELOPE_BEGIN")) {
      add(item(sessionId, index, agent, "team", content, timestamp, "assistant", "Response"));
    }
    return;
  }
  if (event.type === "tool.execution_start" && data.toolCallId) {
    const id = String(data.toolCallId);
    const name = String(data.toolName || "tool");
    tools.set(id, encodeTool(name, data.arguments));
    if (isTerminalHarnessTool(name)) return;
    const projected = projectToolActivity(name, data.arguments, false);
    const message = item(sessionId, index, agent, name, projected.body, timestamp, "tool", projected.title, projected.status, projected.activity);
    pending.set(id, message.id);
    if (!isTrivialToolResult(message.body)) add(message);
    return;
  }
  if (event.type === "tool.execution_complete" && data.toolCallId) {
    const id = String(data.toolCallId);
    const tool = decodeTool(tools.get(id));
    if (isTerminalHarnessTool(tool.name)) return;
    const pendingId = pending.get(id);
    if (pendingId) remove(pendingId);
    pending.delete(id);
    const projected = projectToolActivity(tool.name, tool.arguments, true, data.success !== false);
    add(item(sessionId, index, agent, tool.name, projected.body, timestamp, "tool", projected.title, projected.status, projected.activity));
  }
}

export function parseSessionEvent(line: string): SessionEvent | undefined {
  try { return JSON.parse(line) as SessionEvent; } catch { return undefined; }
}
export function normalizeSessionEventTimestamp(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  if (typeof value !== "string" || !value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}
function item(sessionId: string, index: number, sender: string, recipient: string, body: string, timestamp: string, kind: ChatMessage["kind"], title: string, status = "recorded", activity?: ChatMessage["activity"]): ChatMessage {
  return { id: `event:${sessionId}:${index}`, sender, recipient, body, status, timestamp, direction: "outgoing", kind, title, activity };
}
function isTrivialToolResult(body: string) {
  return ["true", "false", "Query returned 0 rows.", '{"ok":true}', "{\n  \"ok\": true\n}"].includes(body);
}
function isTerminalHarnessTool(name: string) {
  return /(?:^|[._/-])task_complete$/i.test(name);
}
function encodeTool(name: string, arguments_: unknown) { return JSON.stringify({ name, arguments: arguments_ }); }
function decodeTool(value?: string) {
  if (!value) return { name: "tool", arguments: undefined };
  try {
    const parsed = JSON.parse(value) as { name?: unknown; arguments?: unknown };
    return { name: String(parsed.name || "tool"), arguments: parsed.arguments };
  } catch {
    return { name: value, arguments: undefined };
  }
}
