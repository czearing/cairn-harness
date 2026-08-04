import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

const { writeProjectDocument } = await import("../src/server/document-save.ts");

test("document saves stay inside the real project root", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-document-save-"));
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const projectRoot = path.join(fixtureRoot, "project");
  const nested = path.join(projectRoot, "nested");
  const outside = path.join(fixtureRoot, "outside");
  const sibling = path.join(fixtureRoot, "project-sibling");
  const existing = path.join(projectRoot, "existing.md");
  const sentinel = path.join(outside, "sentinel.md");
  mkdirSync(nested, { recursive: true });
  mkdirSync(outside);
  mkdirSync(sibling);
  writeFileSync(existing, "before\n");
  writeFileSync(sentinel, "unchanged\n");
  symlinkSync(outside, path.join(projectRoot, "linked"), process.platform === "win32" ? "junction" : "dir");

  writeProjectDocument(projectRoot, "existing.md", "updated\n\n");
  writeProjectDocument(projectRoot, path.join("nested", "new.md"), "new");

  assert.equal(readFileSync(existing, "utf8"), "updated\n");
  assert.equal(readFileSync(path.join(nested, "new.md"), "utf8"), "new\n");

  if (process.platform === "win32") {
    writeProjectDocument(projectRoot.toUpperCase(), path.join("NESTED", "case.md"), "case");
    assert.equal(readFileSync(path.join(nested, "case.md"), "utf8"), "case\n");
  }

  for (const relative of [
    path.join("linked", "escaped.md"),
    path.join("..", "outside", "traversal.md"),
    path.join("..", "project-sibling", "prefix.md"),
    path.join(outside, "absolute.md"),
  ]) {
    assert.throws(
      () => writeProjectDocument(projectRoot, relative, "escaped"),
      { message: "Document path is outside the project" },
    );
  }

  assert.equal(readFileSync(sentinel, "utf8"), "unchanged\n");
  assert.equal(existsSync(path.join(outside, "escaped.md")), false);
  assert.equal(existsSync(path.join(outside, "traversal.md")), false);
  assert.equal(existsSync(path.join(outside, "absolute.md")), false);
  assert.equal(existsSync(path.join(sibling, "prefix.md")), false);
});
