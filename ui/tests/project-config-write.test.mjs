import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeProjectConfig } from "../src/server/project-config-write.ts";

test("project config replacement preserves canonical bytes until atomic rename", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-config-write-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "harness.json");
  const original = '{\n  "name": "Original",\n  "roles": []\n}\n';
  const updated = { name: "Updated", roles: [{ name: "lead", prompt: "Lead." }] };
  writeFileSync(file, original);

  const partialError = new Error("Temporary write failed");
  assert.throws(() => writeProjectConfig(file, updated, {
    writeFileSync: (temporary, body) => {
      writeFileSync(temporary, body.slice(0, 12));
      throw partialError;
    },
  }), (error) => error === partialError);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.deepEqual(temporaryFiles(root), []);

  const renameError = new Error("Atomic replacement failed");
  assert.throws(() => writeProjectConfig(file, updated, {
    renameSync: () => { throw renameError; },
  }), (error) => error === renameError);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.deepEqual(temporaryFiles(root), []);

  const cleanupError = new Error("Cleanup failed");
  assert.throws(() => writeProjectConfig(file, updated, {
    renameSync: () => { throw renameError; },
    rmSync: () => { throw cleanupError; },
  }), (error) => error === renameError);
  assert.equal(readFileSync(file, "utf8"), original);
  for (const temporary of temporaryFiles(root)) rmSync(path.join(root, temporary), { force: true });

  writeProjectConfig(file, updated, { renameSync });
  assert.equal(readFileSync(file, "utf8"), `${JSON.stringify(updated, null, 2)}\n`);
  assert.deepEqual(temporaryFiles(root), []);
});

function temporaryFiles(root) {
  return readdirSync(root).filter((name) => name.endsWith(".tmp"));
}
