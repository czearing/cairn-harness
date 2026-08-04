import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import { getProject } from "./projects";
import { ensureProjectRunning } from "./supervisor";
import { cancelTaskTree, deleteTerminalTaskTree } from "./task-tree";

export function cancelWorkItem(projectId: string, taskId: string) {
  updateTree(projectId, taskId);
}

export function deleteWorkItem(projectId: string, taskId: string) {
  const project = requiredProject(projectId);
  const db = database(project.root);
  try { deleteTerminalTaskTree(db, taskId); } finally { db.close(); }
}

function updateTree(projectId: string, taskId: string) {
  const project = requiredProject(projectId);
  const db = database(project.root);
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  let changes = 0;
  try {
    changes = Number(cancelTaskTree(db, taskId, now));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  if (!changes) throw new Error("Task not found or already complete");
  ensureProjectRunning(projectId);
}

function requiredProject(id: string) {
  const project = getProject(id);
  if (!project) throw new Error("Project not found");
  return project;
}
function database(root: string) {
  return openDatabase(path.join(root, ".cairn-harness", "harness.db"));
}

