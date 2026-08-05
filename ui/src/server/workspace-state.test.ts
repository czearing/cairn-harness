import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { ensureWorkspaceStateDirectory } from "./workspace-state.ts";

function workspace() {
  return mkdtempSync(path.join(os.tmpdir(), "harness-state-"));
}

test("workspace state directory is created with a self-ignoring gitignore", () => {
  const root = workspace();
  try {
    const directory = ensureWorkspaceStateDirectory(root);
    assert.equal(directory, path.join(root, ".cairn-harness"));
    assert.equal(readFileSync(path.join(directory, ".gitignore"), "utf8"), "*\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an existing gitignore is preserved", () => {
  const root = workspace();
  try {
    const ignore = path.join(ensureWorkspaceStateDirectory(root), ".gitignore");
    writeFileSync(ignore, "custom\n");
    ensureWorkspaceStateDirectory(root);
    assert.equal(readFileSync(ignore, "utf8"), "custom\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness state leaves the workspace repository clean", () => {
  const root = workspace();
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init");
    writeFileSync(path.join(root, "README.md"), "source\n");
    ensureWorkspaceStateDirectory(root);
    writeFileSync(path.join(root, ".cairn-harness", "harness.db"), "state");
    assert.equal(existsSync(path.join(root, ".cairn-harness", "harness.db")), true);
    assert.equal(git("status", "--short").includes(".cairn-harness"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
