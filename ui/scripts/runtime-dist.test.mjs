import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createRuntimeDist,
  removeRuntimeDist,
  sweepOrphanedRuntimeDists,
} from "./runtime-dist.mjs";

test("running build stays immutable when the source build changes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-runtime-"));
  const source = path.join(root, "source");
  const runtime = path.join(root, "runtime");
  try {
    createRuntimeDist(sourceWithChunk(source, "first"), runtime);
    writeFileSync(path.join(source, "chunk.js"), "second");
    assert.equal(readFileSync(path.join(runtime, "chunk.js"), "utf8"), "first");
    removeRuntimeDist(runtime, true);
    assert.throws(() => readFileSync(path.join(runtime, "chunk.js")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a build whose manifest references a missing chunk never becomes the runtime dist", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-runtime-"));
  const source = sourceWithChunk(path.join(root, "source"), "first");
  const runtime = path.join(root, "runtime");
  try {
    writeFileSync(
      path.join(source, "build-manifest.json"),
      JSON.stringify({ pages: { "/": ["static/chunks/absent.js"] } }),
    );
    assert.throws(() => createRuntimeDist(source, runtime), /references missing/);
    assert.throws(() => readFileSync(path.join(runtime, "chunk.js")));
    assert.throws(() => readFileSync(path.join(`${runtime}.staging`, "chunk.js")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a build missing its BUILD_ID never becomes the runtime dist", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-runtime-"));
  const source = path.join(root, "source");
  const runtime = path.join(root, "runtime");
  mkdirSync(source, { recursive: true });
  writeFileSync(path.join(source, "chunk.js"), "first");
  try {
    assert.throws(() => createRuntimeDist(source, runtime), /BUILD_ID is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("orphaned runtime dists are swept while the live one is kept", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-runtime-"));
  try {
    for (const name of [".next-runtime-111", ".next-runtime-222", ".next-runtime-222.staging"]) {
      mkdirSync(path.join(root, name), { recursive: true });
    }
    mkdirSync(path.join(root, "keep-me"), { recursive: true });
    const removed = sweepOrphanedRuntimeDists(root, ".next-runtime-", (pid) => pid === 111);
    assert.deepEqual(removed.sort(), [".next-runtime-222", ".next-runtime-222.staging"]);
    assert.ok(readFileSync !== undefined);
    assert.throws(() => readFileSync(path.join(root, ".next-runtime-222", "any")));
    assert.doesNotThrow(() => rmSync(path.join(root, ".next-runtime-111"), { recursive: true }));
    assert.doesNotThrow(() => rmSync(path.join(root, "keep-me"), { recursive: true }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function sourceWithChunk(directory, content) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "chunk.js"), content);
  writeFileSync(path.join(directory, "BUILD_ID"), "test-build");
  return directory;
}
