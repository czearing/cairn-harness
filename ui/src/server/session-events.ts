import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ChatMessage } from "@/lib/types";

interface SessionEvent {
  type?: string;
  timestamp?: string | number;
  data?: Record<string, unknown>;
}

export function readSessionEvents(root: string, agent: string): ChatMessage[] {
  const directory = path.join(root, ".cairn-harness", "copilot-home", agent, "session-state");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readSession(path.join(directory, entry.name, "events.jsonl"), agent, entry.name))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function readSession(file: string, agent: string, sessionId: string) {
  if (!existsSync(file)) return [];
  const events = readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap(parseLine);
  const tools = new Map<string, string>();
  for (const event of events) {
    const data = event.data || {};
    if (event.type === "tool.execution_start" && data.toolCallId) {
      tools.set(String(data.toolCallId), String(data.toolName || "tool"));
    }
  }
  return events.flatMap((event, index) => eventMessages(event, agent, sessionId, index, tools));
}

function parseLine(line: string): SessionEvent[] {
  try { return [JSON.parse(line) as SessionEvent]; }
  catch { return []; }
}

function eventMessages(event: SessionEvent, agent: string, sessionId: string, index: number, tools: Map<string, string>): ChatMessage[] {
  const data = event.data || {};
  const timestamp = eventTime(event.timestamp);
  switch (event.type) {
    case "assistant.message":
      return data.content ? [item(sessionId, index, agent, "team", String(data.content), timestamp, "assistant", "Response")] : [];
    case "tool.execution_start": {
      const name = String(data.toolName || "tool");
      return [item(sessionId, index, agent, name, compact(data.arguments), timestamp, "tool", `Tool: ${name}`)];
    }
    case "tool.execution_complete": {
      const name = tools.get(String(data.toolCallId)) || "tool";
      return [item(sessionId, index, name, agent, compact(toolResult(data.result, data.success)), timestamp, "tool", `Tool result: ${name}`)];
    }
    case "session.start":
      return [item(sessionId, index, "system", agent, `Session ${String(data.sessionId || sessionId)} started`, timestamp, "session", "Session started")];
    case "session.shutdown":
      return [item(sessionId, index, "system", agent, "Session stopped", timestamp, "session", "Session stopped")];
    default:
      return [];
  }
}

function item(sessionId: string, index: number, sender: string, recipient: string, body: string, timestamp: string, kind: ChatMessage["kind"], title: string): ChatMessage {
  return { id: `event:${sessionId}:${index}`, sender, recipient, body, status: "recorded", timestamp, direction: sender === "dashboard" ? "incoming" : "outgoing", kind, title };
}

function pretty(value: unknown) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value || ""); }
}
function compact(value: unknown) {
  const body = pretty(value);
  return body.length <= 1600 ? body : `${body.slice(0, 1600)}\n\nDetails truncated in chat.`;
}
function toolResult(result: unknown, success: unknown) {
  if (result && typeof result === "object" && "content" in result) {
    return String((result as { content?: unknown }).content || success || "");
  }
  return result || success;
}
function eventTime(value: string | number | undefined) {
  if (typeof value === "number") return new Date(value).toISOString();
  return value || "";
}
