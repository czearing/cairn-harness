import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeProjectStateAndRegistration } from "./project-removal.ts";

test("project removal deletes Harness state and registration but preserves repository files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-project-removal-"));
  const workspace = path.join(root, "workspace");
  const managedRoot = path.join(root, "projects");
  const registration = path.join(managedRoot, "removed-project");
  write(path.join(workspace, "src", "main.ts"), "export {};\n");
  write(path.join(workspace, ".cairn-harness", "harness.db"), "history");
  write(path.join(workspace, ".cairn-harness", "cairn", "cairn.db"), "brain");
  write(path.join(workspace, ".cairn-harness", "copilot-home", "lead", "session-state", "session", "events.jsonl"), "session");
  write(path.join(workspace, ".cairn-harness", "copilot-home", "lead", "skills", "project-skill", "SKILL.md"), "skill");
  write(path.join(registration, "project.json"), "{}");

  removeProjectStateAndRegistration(workspace, registration, managedRoot);

  assert.equal(existsSync(path.join(workspace, ".cairn-harness")), false);
  assert.equal(existsSync(registration), false);
  assert.equal(existsSync(path.join(workspace, "src", "main.ts")), true);
  rmSync(root, { recursive: true, force: true });
});

test("state deletion failure keeps the project registered for retry", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-project-removal-failure-"));
  const workspace = path.join(root, "workspace");
  const managedRoot = path.join(root, "projects");
  const registration = path.join(managedRoot, "project");
  const removed: string[] = [];
  assert.throws(() => removeProjectStateAndRegistration(
    workspace,
    registration,
    managedRoot,
    {
      rmSync: ((target: string) => {
        removed.push(target);
        throw new Error("state is locked");
      }) as typeof import("node:fs").rmSync,
    },
  ), /state is locked/);
  assert.deepEqual(removed, [path.resolve(workspace, ".cairn-harness")]);
  rmSync(root, { recursive: true, force: true });
});

function write(file: string, body: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}
