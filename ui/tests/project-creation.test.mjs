import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { createProject } = await import("../src/server/project-registry.ts");

test("project creation rejects an equivalent canonical workspace and permits a distinct workspace", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-creation-"));
  const previousProjectRoot = process.env.HARNESS_PROJECT_ROOT;
  const previousProjects = process.env.HARNESS_PROJECTS;
  const previousExamples = process.env.HARNESS_DISCOVER_EXAMPLES;
  context.after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECT_ROOT", previousProjectRoot);
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    restoreEnvironment("HARNESS_DISCOVER_EXAMPLES", previousExamples);
  });

  const managedRoot = path.join(fixtureRoot, "projects");
  const workspace = path.join(fixtureRoot, "workspace");
  const alias = path.join(fixtureRoot, "workspace-alias");
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, "sentinel.txt"), "unchanged");
  symlinkSync(workspace, alias, process.platform === "win32" ? "junction" : "dir");
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  delete process.env.HARNESS_PROJECTS;
  delete process.env.HARNESS_DISCOVER_EXAMPLES;

  createProject("Project A", workspace);
  const before = snapshotDirectory(workspace);

  assert.throws(
    () => createProject("Project B", alias),
    { message: "workspace is already used by Project A" },
  );
  assert.equal(existsSync(path.join(managedRoot, "project-b")), false);
  assert.deepEqual(snapshotDirectory(workspace), before);

  const distinctWorkspace = path.join(fixtureRoot, "distinct-workspace");
  mkdirSync(distinctWorkspace);
  assert.equal(createProject("Project C", distinctWorkspace), "project-c");
  assert.equal(existsSync(path.join(managedRoot, "project-c", "project.json")), true);
  assert.equal(existsSync(path.join(distinctWorkspace, ".cairn-harness")), true);
});

test("failed registration persistence rolls back only the directory created by that attempt", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-project-registration-"));
  const previousProjectRoot = process.env.HARNESS_PROJECT_ROOT;
  const previousProjects = process.env.HARNESS_PROJECTS;
  const previousExamples = process.env.HARNESS_DISCOVER_EXAMPLES;
  context.after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    restoreEnvironment("HARNESS_PROJECT_ROOT", previousProjectRoot);
    restoreEnvironment("HARNESS_PROJECTS", previousProjects);
    restoreEnvironment("HARNESS_DISCOVER_EXAMPLES", previousExamples);
  });

  const managedRoot = path.join(fixtureRoot, "projects");
  const workspace = path.join(fixtureRoot, "workspace");
  mkdirSync(managedRoot);
  mkdirSync(workspace);
  writeFileSync(path.join(managedRoot, "sentinel.txt"), "preserve");
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  delete process.env.HARNESS_PROJECTS;
  delete process.env.HARNESS_DISCOVER_EXAMPLES;
  const before = snapshotDirectory(managedRoot);
  const persistenceError = new Error("injected registration write failure");

  assert.throws(() => createProject("Transient Project", workspace, {
    writeProjectConfig: (file) => {
      assert.equal(existsSync(path.dirname(file)), true);
      writeFileSync(file, "partial");
      throw persistenceError;
    },
  }), (error) => error === persistenceError);
  assert.deepEqual(snapshotDirectory(managedRoot), before);
  assert.equal(existsSync(path.join(managedRoot, "transient-project")), false);

  assert.equal(createProject("Transient Project", workspace), "transient-project");
  assert.equal(existsSync(path.join(workspace, ".cairn-harness")), true);
  assert.equal(existsSync(path.join(workspace, "work-items", "inbox")), true);
  assert.equal(readFileSync(path.join(managedRoot, "transient-project", "project.json"), "utf8"), `${JSON.stringify({
    name: "Transient Project",
    root: realpathSync.native(workspace),
    work_dir: "work-items",
    roles: [],
  }, null, 2)}\n`);

  const occupiedDirectory = path.join(managedRoot, "occupied");
  const occupiedWorkspace = path.join(fixtureRoot, "occupied-workspace");
  mkdirSync(occupiedDirectory);
  mkdirSync(occupiedWorkspace);
  writeFileSync(path.join(occupiedDirectory, "sentinel.txt"), "unchanged");
  assert.throws(
    () => createProject("Occupied", occupiedWorkspace),
    { message: "A project with this name already exists" },
  );
  assert.equal(readFileSync(path.join(occupiedDirectory, "sentinel.txt"), "utf8"), "unchanged");
});

function snapshotDirectory(directory) {
  return readdirSync(directory, { recursive: true })
    .map(String)
    .sort()
    .map((relative) => {
      const file = path.join(directory, relative);
      return lstatSync(file).isFile()
        ? [relative, readFileSync(file, "utf8")]
        : [relative, null];
    });
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
