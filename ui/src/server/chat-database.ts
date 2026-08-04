import type { DatabaseSync } from "node:sqlite";
import type { Agent, ChatMessage } from "@/lib/types";
import { persistedMessageState, submissionIdFromTask } from "../lib/message-lifecycle.ts";
import { cursor, cursorClause, splitCursor, type CursorParts } from "./chat-order.ts";
import { parseTurnOutput } from "./turn-output";

const turnColumnCache = new WeakMap<DatabaseSync, string>();

export function resolveDatabaseFocus(db: DatabaseSync, agent: Agent, focusId: string) {
  if (focusId.startsWith("task:")) {
    const raw = focusId.slice(5);
    const rows = queryAll(db, `SELECT id,creator,assignee,body,status,error,created_at FROM tasks
      WHERE (id=? OR id=?) AND (creator=? OR assignee=?) LIMIT 2`,
    focusId, raw, agent.id, agent.id);
    const row = rows.find((candidate) => taskChatId(candidate.id) === focusId);
    return row ? taskMessage(row, agent) : undefined;
  }
  if (!focusId.startsWith("turn:")) return undefined;
  const sequence = Number(focusId.slice(5));
  if (!Number.isInteger(sequence)) return undefined;
  const row = queryAll(db, `SELECT sequence,${turnExtraColumns(db)},agent_id,output_json,status,completed_at FROM turns
    WHERE sequence=? AND agent_id=? LIMIT 1`,
  sequence, agent.id)[0];
  return row && turnIsVisible(db, agent.id, String(row.completed_at)) ? turnMessage(row, agent) : undefined;
}

export function readDatabasePage(db: DatabaseSync, agent: Agent, before: string | undefined, limit: number) {
  const boundary = before ? splitCursor(before) : undefined;
  const merged = [...readTasks(db, agent, boundary, "before", limit + 1),
    ...readTurns(db, agent, boundary, "before", limit + 1)].sort((a, b) => cursor(a).localeCompare(cursor(b)));
  const items = merged.slice(-limit);
  const earliest = items[0] ? cursor(items[0]) : before;
  return { items, hasMore: Boolean(earliest && hasDatabaseBefore(db, agent, earliest)) };
}

export function readDatabaseWindow(db: DatabaseSync, agent: Agent, anchor: string, limit: number) {
  const boundary = splitCursor(anchor);
  return [
    ...readTasks(db, agent, boundary, "before", limit),
    ...readTurns(db, agent, boundary, "before", limit),
    ...readTasks(db, agent, boundary, "after", limit),
    ...readTurns(db, agent, boundary, "after", limit),
  ];
}

export function hasDatabaseBefore(db: DatabaseSync, agent: Agent, before: string) {
  const boundary = splitCursor(before);
  return readTasks(db, agent, boundary, "before", 1).length > 0
    || readTurns(db, agent, boundary, "before", 1).length > 0;
}

function readTasks(db: DatabaseSync, agent: Agent, boundary: CursorParts | undefined, side: "before" | "after", limit: number) {
  const comparison = cursorClause("created_at", "CASE WHEN id LIKE 'task:%' THEN id ELSE 'task:' || id END", boundary, side);
  return queryAll(db, `SELECT id,creator,assignee,body,status,error,created_at FROM tasks
    WHERE (creator=? OR assignee=?)${comparison.sql}
    ORDER BY created_at ${side === "before" ? "DESC" : "ASC"}, CASE WHEN id LIKE 'task:%' THEN id ELSE 'task:' || id END ${side === "before" ? "DESC" : "ASC"} LIMIT ?`,
  agent.id, agent.id, ...comparison.values, limit).map((row) => taskMessage(row, agent));
}

function readTurns(db: DatabaseSync, agent: Agent, boundary: CursorParts | undefined, side: "before" | "after", limit: number) {
  const comparison = cursorClause("completed_at", "'turn:' || sequence", boundary, side);
  return queryAll(db, `SELECT sequence,${turnExtraColumns(db)},agent_id,output_json,status,completed_at FROM turns
    WHERE agent_id=?${comparison.sql}
    AND NOT EXISTS (
      SELECT 1 FROM tasks message WHERE message.creator=?
      AND julianday(message.created_at) >= julianday(turns.completed_at)
      AND julianday(message.created_at) < julianday(turns.completed_at, '+2 seconds')
    )
    ORDER BY completed_at ${side === "before" ? "DESC" : "ASC"}, 'turn:' || sequence ${side === "before" ? "DESC" : "ASC"} LIMIT ?`,
  agent.id, ...comparison.values, agent.id, limit).map((row) => turnMessage(row, agent));
}

function taskMessage(row: Record<string, unknown>, agent: Agent): ChatMessage {
  const id = taskChatId(row.id);
  return {
    id, sender: String(row.creator), recipient: String(row.assignee), body: String(row.body),
    status: String(row.status), timestamp: String(row.created_at),
    direction: row.creator === "dashboard" || row.creator === "human" || row.creator === "work-items" ? "incoming" : "outgoing",
    kind: "message", submissionId: submissionIdFromTask(id),
    deliveryState: persistedMessageState(String(row.status), agent),
    error: row.error ? String(row.error) : undefined,
  };
}

function turnMessage(row: Record<string, unknown>, agent: Agent): ChatMessage {
  const { output } = parseTurnOutput(row.output_json);
  const body = [output.summary, output.deliverable].filter((value, index, values) => value && values.indexOf(value) === index).join("\n\n");
  return {
    id: `turn:${row.sequence}`, sender: agent.id, recipient: "team", body: body || "Completed work",
    status: String(row.status), timestamp: String(row.completed_at), direction: "outgoing", kind: "turn",
    title: "Completed turn", deliveryState: "replied",
    replyToId: row.message_id ? taskChatId(row.message_id) : undefined,
  };
}

function turnIsVisible(db: DatabaseSync, agent: string, completedAt: string) {
  const end = new Date(Date.parse(completedAt) + 2_000).toISOString();
  return !queryAll(db, "SELECT 1 FROM tasks WHERE creator=? AND created_at>=? AND created_at<? LIMIT 1", agent, completedAt, end).length;
}
function queryAll(db: DatabaseSync, sql: string, ...values: unknown[]) {
  return db.prepare(sql).all(...values.map(String)) as Record<string, unknown>[];
}
function turnExtraColumns(db: DatabaseSync) {
  const cached = turnColumnCache.get(db);
  if (cached) return cached;
  const columns = new Set((db.prepare("PRAGMA table_info(turns)").all() as Array<{ name?: unknown }>).map((column) => String(column.name)));
  const projection = [columns.has("message_id") ? "message_id" : "NULL AS message_id", columns.has("started_at") ? "started_at" : "NULL AS started_at"].join(",");
  turnColumnCache.set(db, projection);
  return projection;
}
function taskChatId(id: unknown) {
  const value = String(id);
  return value.startsWith("task:") ? value : `task:${value}`;
}
