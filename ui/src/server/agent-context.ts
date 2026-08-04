import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import { resetAgentContext } from "./context-reset";

export function clearAgentContextState(root: string, agentId: string) {
  const database = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(database)) throw new Error("Project database not found");
  const db = openDatabase(database);
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    resetAgentContext(db, root, agentId, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

