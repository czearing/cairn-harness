import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { firstExistingPath, newestExistingPath } from "../src/server/binary-selection.ts";

test("worker startup selects the newest built binary", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-binary-"));
  const release = path.join(root, "release.exe");
  const debug = path.join(root, "debug.exe");
  closeSync(openSync(release, "w"));
  closeSync(openSync(debug, "w"));
  utimesSync(release, new Date(1_000), new Date(1_000));
  utimesSync(debug, new Date(2_000), new Date(2_000));
  assert.equal(newestExistingPath([release, debug]), debug);
});

test("worker startup prefers the deployed release binary", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-binary-"));
  const release = path.join(root, "release.exe");
  const debug = path.join(root, "debug.exe");
  closeSync(openSync(release, "w"));
  closeSync(openSync(debug, "w"));
  utimesSync(release, new Date(1_000), new Date(1_000));
  utimesSync(debug, new Date(2_000), new Date(2_000));

  assert.equal(firstExistingPath([release, debug]), release);
});
