import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "./sqlite.ts";

test("the shared helper opens a writable connection", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-sqlite-write-"));
  const file = path.join(root, "harness.db");
  const db = openDatabase(file);
  try {
    db.exec("CREATE TABLE probe(id TEXT PRIMARY KEY)");
    assert.equal(db.prepare("INSERT INTO probe(id) VALUES(?)").run("written").changes, 1);
    assert.deepEqual(db.prepare("SELECT id FROM probe").all().map((row) => (row as { id: string }).id), ["written"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the shared helper opens a read-only connection that rejects writes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-sqlite-readonly-"));
  const file = path.join(root, "harness.db");
  const writable = openDatabase(file);
  writable.exec("CREATE TABLE probe(id TEXT PRIMARY KEY)");
  writable.close();

  const db = openDatabase(file, { readOnly: true });
  try {
    assert.deepEqual(db.prepare("SELECT id FROM probe").all(), []);
    assert.throws(() => db.exec("INSERT INTO probe(id) VALUES('blocked')"));
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
