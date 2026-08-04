import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import type { Project } from "@/lib/types";

type VersionDatabase = Pick<DatabaseSync, "prepare" | "close">;
type VersionDatabaseFactory = (file: string) => VersionDatabase;

export function conversationVersions(project: Project) {
  return createConversationVersionReader((file) => openDatabase(file, { readOnly: true }))(project);
}

export function createConversationVersionReader(
  openDatabase: VersionDatabaseFactory,
  fileExists: (file: string) => boolean = existsSync,
) {
  return (project: Project) => {
    const versions = new Map<string, string>();
    const file = path.join(project.root, ".cairn-harness", "harness.db");
    if (!fileExists(file)) return versions;
    const configured = JSON.stringify(project.agents.map((agent) => agent.id));
    const db = openDatabase(file);
    try {
      const tasks = components(db, `/* conversation-task-versions */
        WITH configured(agent_id) AS (SELECT value FROM json_each(?))
        SELECT configured.agent_id,
          coalesce(max(tasks.created_at),'') || '|' ||
          coalesce(max(tasks.claimed_at),'') || '|' ||
          coalesce(max(tasks.completed_at),'') || '|' ||
          count(tasks.id) || '|' ||
          coalesce(sum(tasks.status='pending'),0) || '|' ||
          coalesce(sum(tasks.status='claimed'),0) || '|' ||
          coalesce(sum(tasks.status='completed'),0) || '|' ||
          coalesce(sum(tasks.status='failed'),0) || '|' ||
          coalesce(sum(tasks.status='cancelled'),0) || '|' ||
          coalesce(sum(tasks.attempts),0) value
        FROM configured
        LEFT JOIN tasks ON tasks.creator=configured.agent_id OR tasks.assignee=configured.agent_id
        GROUP BY configured.agent_id`, configured);
      const turns = components(db, `/* conversation-turn-versions */
        WITH configured(agent_id) AS (SELECT value FROM json_each(?))
        SELECT configured.agent_id,max(turns.completed_at) value FROM configured
        LEFT JOIN turns ON turns.agent_id=configured.agent_id
        GROUP BY configured.agent_id`, configured);
      let resets = new Map<string, string>();
      try {
        resets = components(db, `/* conversation-reset-versions */
          WITH configured(agent_id) AS (SELECT value FROM json_each(?))
          SELECT configured.agent_id,max(context_resets.cleared_at) value FROM configured
          LEFT JOIN context_resets ON context_resets.agent_id=configured.agent_id
          GROUP BY configured.agent_id`, configured);
      } catch {}
      for (const agent of project.agents) {
        versions.set(agent.id, `${tasks.get(agent.id) || ""}|${turns.get(agent.id) || ""}|${resets.get(agent.id) || ""}`);
      }
    } catch {}
    finally { db.close(); }
    return versions;
  };
}

function components(db: VersionDatabase, sql: string, configured: string) {
  const rows = db.prepare(sql).all(configured) as { agent_id: string; value?: string }[];
  return new Map(rows.map((row) => [String(row.agent_id), String(row.value || "")]));
}

