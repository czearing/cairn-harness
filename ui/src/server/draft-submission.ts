import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import { admitDashboardRoot } from "./root-task-admission.ts";

interface DraftPersistenceDependencies {
  removeDraft: (file: string) => void;
}

const defaultDependencies: DraftPersistenceDependencies = {
  removeDraft: (file) => rmSync(file, { force: true }),
};

export function persistDraftSubmission(
  projectRoot: string,
  leader: string,
  id: string,
  body: string,
  dependencies: DraftPersistenceDependencies = defaultDependencies,
) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid draft id");
  const submittedBody = body.trim();
  if (!submittedBody) throw new Error("Task is required");
  const db = openDatabase(path.join(projectRoot, ".cairn-harness", "harness.db"));
  let created = false;
  let taskId = `dashboard-draft-${id}`;
  try {
    taskId = submissionTaskId(db, taskId, submittedBody);
    created = admitDashboardRoot(db, {
      id: taskId,
      assignee: leader,
      topic: "work-item",
      body: submittedBody,
      createdAt: new Date().toISOString(),
    }).created;
    const existing = db.prepare("SELECT kind,source,creator,topic,body FROM tasks WHERE id=?").get(taskId) as {
      kind: string; source: string; creator: string; topic: string; body: string;
    } | undefined;
    if (!existing
      || existing.kind !== "root"
      || existing.source !== "manual"
      || existing.creator !== "dashboard"
      || existing.topic !== "work-item"
      || existing.body !== submittedBody) {
      throw new Error("Draft submission conflicts with an existing task");
    }
  } finally {
    db.close();
  }

  dependencies.removeDraft(path.join(projectRoot, ".cairn-harness", "drafts", `${id}.md`));
  return { created, taskId };
}

function submissionTaskId(db: DatabaseSync, baseId: string, body: string) {
  const existing = db.prepare("SELECT body FROM tasks WHERE id=?").get(baseId) as { body: string } | undefined;
  if (!existing || existing.body === body) return baseId;
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 16);
  return `${baseId}-${digest}`;
}

