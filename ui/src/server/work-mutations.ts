import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getProject } from "./projects";
import { ensureProjectRunning } from "./supervisor";

export function cancelWorkItem(projectId: string, workItemId: string) {
  const project = requiredProject(projectId);
  const db = projectDatabase(project.root);
  const item = db.prepare("SELECT path,message_id,status FROM work_items WHERE id=?").get(workItemId) as { path: string; message_id: string; status: string } | undefined;
  if (!item) { db.close(); throw new Error("Task not found"); }
  if (terminal(item.status)) { db.close(); return; }
  const active = db.prepare("SELECT DISTINCT recipient FROM messages WHERE (id=? OR id LIKE ?) AND status IN ('pending','claimed')").all(item.message_id, `${item.message_id}:%`) as { recipient: string }[];
  const body = readFileSync(path.join(project.root, item.path), "utf8");
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE messages SET status='cancelled',claimed_at=NULL,completed_at=? WHERE (id=? OR id LIKE ?) AND status IN ('pending','claimed')")
      .run(now, item.message_id, `${item.message_id}:%`);
    db.prepare("UPDATE work_items SET status='cancelled',completed_at=? WHERE id=?").run(now, workItemId);
    db.prepare("INSERT INTO messages(id,sender,recipient,topic,body,status,created_at) VALUES(?,?,?,?,?,'pending',?)")
      .run(randomUUID(), "dashboard", project.agents.find((agent) => agent.isLeader)?.id || project.agents[0]?.id, "task-cancelled", cancellationBody(body, active.map((row) => row.recipient)), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  ensureProjectRunning(projectId);
}

export function deleteWorkItem(projectId: string, workItemId: string) {
  const project = requiredProject(projectId);
  const db = projectDatabase(project.root);
  const item = db.prepare("SELECT path,status FROM work_items WHERE id=?").get(workItemId) as { path: string; status: string } | undefined;
  if (!item) { db.close(); throw new Error("Task not found"); }
  if (!terminal(item.status)) { db.close(); throw new Error("Cancel the task before deleting it"); }
  db.prepare("DELETE FROM work_items WHERE id=?").run(workItemId);
  db.close();
  rmSync(path.join(project.root, item.path), { force: true });
}

export function deleteTodo(projectId: string, relative: string) {
  const project = requiredProject(projectId);
  const db = projectDatabase(project.root);
  const todo = db.prepare(`SELECT t.message_id,m.recipient,m.body,
    (SELECT w.path FROM work_items w WHERE t.message_id=w.message_id OR t.message_id LIKE w.message_id || ':%' ORDER BY length(w.message_id) DESC LIMIT 1) parent_path
    FROM todo_files t JOIN messages m ON m.id=t.message_id WHERE t.path=?`).get(relative) as { message_id: string; recipient: string; body: string; parent_path?: string } | undefined;
  if (!todo) { db.close(); throw new Error("Delegated action not found"); }
  const parent = todo.parent_path ? readFileSync(path.join(project.root, todo.parent_path), "utf8") : "Unknown parent task";
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE messages SET status='cancelled',claimed_at=NULL,completed_at=? WHERE (id=? OR id LIKE ?) AND status IN ('pending','claimed')")
      .run(now, todo.message_id, `${todo.message_id}:%`);
    db.prepare("DELETE FROM todo_files WHERE path=?").run(relative);
    db.prepare("INSERT INTO messages(id,sender,recipient,topic,body,status,created_at) VALUES(?,?,?,?,?,'pending',?)")
      .run(randomUUID(), "dashboard", todo.recipient, "delegated-action-cancelled", `Stop work on this delegated action.\n\nAction:\n${todo.body}\n\nParent task:\n${parent}`, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  rmSync(path.join(project.root, relative), { force: true });
  ensureProjectRunning(projectId);
}

function requiredProject(id: string) {
  const project = getProject(id);
  if (!project) throw new Error("Project not found");
  return project;
}
function projectDatabase(root: string) {
  return new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"));
}
function terminal(status: string) {
  return ["cancelled", "done", "completed", "released"].includes(status);
}
function cancellationBody(body: string, assignees: string[]) {
  const recipients = [...new Set(assignees)].join(", ") || "none";
  return `The operator cancelled this task. Do not continue or publish further work from its task tree.\n\nTask:\n${body}\n\nAgents who had active work: ${recipients}.\nNotify any relevant teammates that their work is cancelled.`;
}
