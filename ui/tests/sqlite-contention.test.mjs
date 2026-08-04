import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverDir = fileURLToPath(new URL("../src/server/", import.meta.url));

test("every harness database connection waits out lock contention", () => {
  const offenders = [];
  for (const entry of readdirSync(serverDir)) {
    if (!entry.endsWith(".ts") || entry === "sqlite.ts" || entry.endsWith(".test.ts")) continue;
    const source = readFileSync(path.join(serverDir, entry), "utf8");
    if (/new DatabaseSync\(/.test(source)) offenders.push(entry);
  }
  assert.deepEqual(offenders, [], `these modules bypass openDatabase and fail instantly on SQLITE_BUSY: ${offenders.join(", ")}`);
});

test("the shared connection helper applies a busy timeout", () => {
  const helper = readFileSync(path.join(serverDir, "sqlite.ts"), "utf8");
  assert.match(helper, /PRAGMA busy_timeout/);
  assert.match(helper, /export function openDatabase/);
});
