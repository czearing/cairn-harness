import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { projectRemovalCopy } from "../src/components/ProjectContextMenu/project-removal-copy.ts";
import { removeManagedProjectDirectory } from "../src/server/project-removal.ts";

test("project removal copy describes the filesystem behavior truthfully", () => {
  assert.deepEqual(projectRemovalCopy({ id: "example-project", name: "Example project" }), {
    menuItem: "Remove project…",
    heading: "Remove Example project?",
    explanation: "Agents for this project will stop and the project will disappear from Harness. Workspace files and local .cairn-harness data and history remain on disk.",
    action: "Remove project",
    pending: "Removing project",
  });
});

test("project removal deletes only the managed registration directory", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-removal-"));
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const managedRoot = path.join(fixtureRoot, "projects");
  const projectDirectory = path.join(managedRoot, "example-project");
  const workspace = path.join(fixtureRoot, "workspace");
  const historyDirectory = path.join(workspace, ".cairn-harness");
  const workspaceSentinel = path.join(workspace, "workspace-sentinel.txt");
  const historySentinel = path.join(historyDirectory, "history-sentinel.txt");

  mkdirSync(projectDirectory, { recursive: true });
  mkdirSync(historyDirectory, { recursive: true });
  writeFileSync(path.join(projectDirectory, "project.json"), JSON.stringify({ name: "Example project", root: workspace, roles: [] }));
  writeFileSync(workspaceSentinel, "workspace remains");
  writeFileSync(historySentinel, "history remains");

  removeManagedProjectDirectory(projectDirectory, managedRoot);

  assert.equal(existsSync(projectDirectory), false);
  assert.equal(existsSync(workspaceSentinel), true);
  assert.equal(existsSync(historySentinel), true);
});

test("project removal refuses directories outside the managed root", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-removal-"));
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const managedRoot = path.join(fixtureRoot, "projects");
  const outsideDirectory = path.join(fixtureRoot, "outside-project");
  const sentinel = path.join(outsideDirectory, "project.json");
  mkdirSync(managedRoot, { recursive: true });
  mkdirSync(outsideDirectory, { recursive: true });
  writeFileSync(sentinel, "{}");

  assert.throws(
    () => removeManagedProjectDirectory(outsideDirectory, managedRoot),
    /outside the managed projects directory/,
  );
  assert.equal(existsSync(sentinel), true);
});
