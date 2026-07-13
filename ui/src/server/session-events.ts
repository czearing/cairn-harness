import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ChatMessage } from "@/lib/types";

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
  return readFileSync(file, "utf8").split("\n").filter(Boolean)
    .flatMap((line, index) => parseLine(line, agent, sessionId, index));
}

function parseLine(line: string, agent: string, sessionId: string, index: number): ChatMessage[] {
  try {
    const event = JSON.parse(line) as { type?: string; timestamp?: string | number; data?: Record<string, unknown> };
    const data = event.data || {};
    const timestamp = eventTime(event.timestamp);
    switch (event.type) {
      case "user.message":
        return [item(sessionId, index, "dashboard", agent, String(data.content || ""), timestamp, "message", "Prompt")];
      case "assistant.message": {
        const output = [];
        if (data.reasoningText) output.push(item(sessionId, index, agent, "team", String(data.reasoningText), timestamp, "assistant", "Reasoning"));
        if (data.content) output.push(item(sessionId, index + 0.1, agent, "team", String(data.content), timestamp, "assistant", "Response"));
        return output;
      }
      case "tool.execution_start":
        return [item(sessionId, index, agent, String(data.toolName || "tool"), pretty(data.arguments), timestamp, "tool", `Tool: ${data.toolName || "unknown"}`)];
      case "tool.execution_complete":
        return [item(sessionId, index, String(data.toolName || "tool"), agent, pretty(data.result || data.success), timestamp, "tool", `Tool result: ${data.toolName || "unknown"}`)];
      case "session.start":
        return [item(sessionId, index, "system", agent, `Session ${String(data.sessionId || sessionId)} started`, timestamp, "session", "Session started")];
      case "session.shutdown":
        return [item(sessionId, index, "system", agent, "Session stopped", timestamp, "session", "Session stopped")];
      default:
        return [];
    }
  } catch {
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
function eventTime(value: string | number | undefined) {
  if (typeof value === "number") return new Date(value).toISOString();
  return value || "";
}
