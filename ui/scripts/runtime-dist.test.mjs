import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRuntimeDist, removeRuntimeDist } from "./runtime-dist.mjs";

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

function sourceWithChunk(directory, content) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "chunk.js"), content);
  return directory;
}
