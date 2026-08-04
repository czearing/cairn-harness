import type { DatabaseSync } from "node:sqlite";
import type { QueueItem } from "@/lib/types";
import { taskStatusPresentation } from "../lib/task-status.ts";

export function readDelegatedActions(db: DatabaseSync, paused: boolean): QueueItem[] {
  return db.prepare(`SELECT child.id,child.parent_id,child.kind,child.body,child.status,
    child.creator,child.assignee,child.topic,child.created_at,
    COALESCE(child.completed_at,child.claimed_at,child.created_at) updated_at,
    parent.body parent_body
    FROM tasks child LEFT JOIN tasks parent ON parent.id=child.parent_id
    WHERE child.kind='delegation'
    ORDER BY child.created_at DESC,child.id DESC`).all()
    .map((row) => taskProjection(row as Record<string, unknown>, "delegation", paused));
}

export function rootTaskItem(row: Record<string, unknown>, paused: boolean, displayStatus?: string): QueueItem {
  return taskProjection(row, "root", paused, displayStatus);
}

function taskProjection(row: Record<string, unknown>, taskKind: "root" | "delegation", paused: boolean, displayStatus?: string): QueueItem {
  const id = String(row.id);
  const content = String(row.body || "");
  const rawStatus = String(row.status);
  const projectedStatus = displayStatus || rawStatus;
  const effectiveStatus = paused && !taskStatusPresentation(projectedStatus).terminal ? "paused" : projectedStatus;
  const status = taskStatusPresentation(effectiveStatus);
  const parentId = row.parent_id ? String(row.parent_id) : undefined;
  const parent = row.parent_body ? documentLabel(String(row.parent_body)) : undefined;
  const executorId = row.assignee ? String(row.assignee) : undefined;
  return {
    id,
    title: taskKind === "root" ? documentLabel(content) : actionLabel(String(row.topic || ""), content),
    meta: id,
    status: effectiveStatus,
    rawStatus,
    canonicalStatus: status.canonical,
    statusLabel: status.label,
    taskKind,
    parentId,
    accountableId: row.creator ? String(row.creator) : undefined,
    executorId,
    content,
    context: taskKind === "delegation"
      ? parent ? `For ${parent}` : parentId ? `Missing parent ${parentId}` : "Project delegation"
      : undefined,
    agentId: executorId,
    chatId: taskChatId(id),
    updatedAt: String(row.updated_at || row.created_at || ""),
  };
}

function taskChatId(id: string) {
  return id.startsWith("task:") ? id : `task:${id}`;
}

function documentLabel(content: string) {
  const first = content.split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !/^[a-z_-]+:\s/i.test(line));
  return first?.slice(0, 80) || "Untitled task";
}

function actionLabel(topic: string, content: string) {
  const words = /[/.]/.test(topic) ? "" : topic.replace(/[-_]+/g, " ").replace(/\b(todo|task)\b/g, "").trim();
  if (words) return words.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 56);
  return documentLabel(content).split(/[.!?]/)[0].slice(0, 56);
}
