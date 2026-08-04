import type { ChatMessage } from "@/lib/types";

export interface CursorParts { timestamp: string; id: string; }

export function cursor(message: ChatMessage) {
  return `${message.timestamp}\u0000${message.id}`;
}

export function splitCursor(value: string): CursorParts {
  const separator = value.indexOf("\u0000");
  return separator < 0
    ? { timestamp: value, id: "" }
    : { timestamp: value.slice(0, separator), id: value.slice(separator + 1) };
}

export function cursorClause(timestamp: string, id: string, boundary: CursorParts | undefined, side: "before" | "after") {
  if (!boundary) return { sql: "", values: [] as unknown[] };
  const operator = side === "before" ? "<" : ">";
  return {
    sql: ` AND (${timestamp}${operator}? OR (${timestamp}=? AND ${id}${operator}?))`,
    values: [boundary.timestamp, boundary.timestamp, boundary.id],
  };
}

export function compareMessages(a: ChatMessage, b: ChatMessage) {
  return cursor(a).localeCompare(cursor(b));
}

export function dedupe(messages: ChatMessage[], preserveId?: string) {
  const seen = new Set<string>();
  const positions = new Map<string, number>();
  const result: ChatMessage[] = [];
  for (const message of messages) {
    if (message.kind === "message") {
      result.push(message);
      continue;
    }
    const key = `${message.kind}\0${message.sender}\0${message.body.replace(/\s+/g, " ").trim()}`;
    if (seen.has(key)) {
      const position = positions.get(key);
      if (message.id === preserveId && position !== undefined && result[position].id !== preserveId) {
        result[position] = message;
      }
      continue;
    }
    seen.add(key);
    positions.set(key, result.length);
    result.push(message);
  }
  return result.sort(compareMessages);
}
