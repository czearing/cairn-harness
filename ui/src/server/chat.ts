import type { DatabaseSync } from "node:sqlite";
import type { Agent, ChatMessage, ConversationPage } from "@/lib/types";
import { readSessionEvents } from "./session-events";

export function readConversationPage(db: DatabaseSync, root: string, agent: Agent, before?: string, focusId?: string, limit = 80): ConversationPage {
  const all = readConversation(db, root, agent);
  if (focusId) {
    const focus = all.findIndex((message) => message.id === focusId);
    if (focus >= 0) {
      const start = Math.max(0, focus - Math.floor(limit / 2));
      const items = all.slice(start);
      return { items, hasMore: start > 0, nextBefore: items[0] ? cursor(items[0]) : undefined };
    }
  }
  const eligible = before ? all.filter((message) => cursor(message) < before) : all;
  const items = eligible.slice(-limit);
  return { items, hasMore: eligible.length > items.length, nextBefore: items[0] ? cursor(items[0]) : undefined };
}

function readConversation(db: DatabaseSync, root: string, agent: Agent): ChatMessage[] {
  const messages = safeAll(db,
    "SELECT id,sender,recipient,body,status,created_at FROM messages WHERE sender=? OR recipient=?",
    agent.id, agent.id,
  ).map((row) => ({
    id: `message:${row.id}`,
    sender: String(row.sender),
    recipient: String(row.recipient),
    body: String(row.body),
    status: String(row.status),
    timestamp: String(row.created_at),
    direction: row.sender === "dashboard" || row.sender === "human" ? "incoming" as const : "outgoing" as const,
    kind: "message" as const,
  }));
  const turns = safeAll(db,
    "SELECT sequence,agent_id,output_json,status,completed_at FROM turns WHERE agent_id=?",
    agent.id,
  ).map((row) => {
    const output = parseOutput(row.output_json);
    const body = [output.summary, output.deliverable]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join("\n\n");
    return {
      id: `turn:${row.sequence}`,
      sender: agent.id,
      recipient: "team",
      body: body || "Completed work",
      status: String(row.status),
      timestamp: String(row.completed_at),
      direction: "outgoing" as const,
      kind: "turn" as const,
      title: "Completed turn",
    };
  });
  const session = readSessionEvents(root, agent.id);
  return [...messages, ...turns, ...session].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function cursor(message: ChatMessage) {
  return `${message.timestamp}\u0000${message.id}`;
}

function safeAll(db: DatabaseSync, sql: string, ...values: unknown[]) {
  try { return db.prepare(sql).all(...values.map(String)) as Record<string, unknown>[]; }
  catch { return []; }
}

function parseOutput(value: unknown) {
  try { return JSON.parse(String(value)) as { summary?: string; deliverable?: string }; }
  catch { return {}; }
}
