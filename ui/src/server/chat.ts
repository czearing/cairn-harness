import type { DatabaseSync } from "node:sqlite";
import type { Agent, ChatMessage } from "@/lib/types";

export function readConversations(db: DatabaseSync, agents: Agent[]) {
  return Object.fromEntries(agents.map((agent) => [agent.id, readConversation(db, agent.id)]));
}

function readConversation(db: DatabaseSync, agent: string): ChatMessage[] {
  const messages = safeAll(db,
    "SELECT id,sender,recipient,body,status,created_at FROM messages WHERE sender=? OR recipient=?",
    agent, agent,
  ).map((row) => ({
    id: `message:${row.id}`,
    sender: String(row.sender),
    recipient: String(row.recipient),
    body: String(row.body),
    status: String(row.status),
    timestamp: String(row.created_at),
    direction: row.sender === agent ? "outgoing" as const : "incoming" as const,
  }));
  const turns = safeAll(db,
    "SELECT sequence,agent_id,output_json,status,completed_at FROM turns WHERE agent_id=?",
    agent,
  ).map((row) => {
    const output = parseOutput(row.output_json);
    const body = [output.summary, output.deliverable]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join("\n\n");
    return {
      id: `turn:${row.sequence}`,
      sender: agent,
      recipient: "team",
      body: body || "Completed work",
      status: String(row.status),
      timestamp: String(row.completed_at),
      direction: "outgoing" as const,
    };
  });
  return [...messages, ...turns].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function safeAll(db: DatabaseSync, sql: string, ...values: unknown[]) {
  try { return db.prepare(sql).all(...values.map(String)) as Record<string, unknown>[]; }
  catch { return []; }
}

function parseOutput(value: unknown) {
  try { return JSON.parse(String(value)) as { summary?: string; deliverable?: string }; }
  catch { return {}; }
}
