import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";
import {
  cachedHealth,
  healthInputSignature,
  invalidateHealthSnapshot,
  storeHealth,
} from "../src/server/health-snapshot.ts";

const healthy = { status: "healthy", label: "All systems operational", issues: [] };
const attention = { status: "attention", label: "1 issue", issues: [] };

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "harness-health-"));
  mkdirSync(path.join(root, ".cairn-harness"), { recursive: true });
  return { id: "demo", root };
}

function writeDatabase(root, contents) {
  writeFileSync(path.join(root, ".cairn-harness", "harness.db"), contents);
}

beforeEach(() => invalidateHealthSnapshot());

test("a health read is reused while its inputs are unchanged", () => {
  const target = project();
  writeDatabase(target.root, "one");
  const signature = healthInputSignature([target]);

  storeHealth(signature, healthy);

  assert.equal(cachedHealth(signature), healthy);
});

test("missing health inputs still produce a stable signature", () => {
  const target = project();

  assert.equal(healthInputSignature([target]), healthInputSignature([target]));
});

test("changed project databases produce a different signature", () => {
  const target = project();
  writeDatabase(target.root, "one");
  const before = healthInputSignature([target]);
  writeDatabase(target.root, "one-plus-more");

  assert.notEqual(healthInputSignature([target]), before);
});

test("invalidating the snapshot forces the next read to recompute", () => {
  const target = project();
  writeDatabase(target.root, "one");
  const signature = healthInputSignature([target]);
  storeHealth(signature, healthy);

  invalidateHealthSnapshot();

  assert.equal(cachedHealth(signature), undefined);
});

test("a stored read is reused for a changed signature only inside the bounded window", () => {
  const target = project();
  writeDatabase(target.root, "one");
  storeHealth(healthInputSignature([target]), attention);
  writeDatabase(target.root, "two");

  // Agents write continuously, so the signature rarely matches. The bounded window is what
  // keeps the blocking scan from repeating for every poll of every open tab.
  assert.equal(cachedHealth(healthInputSignature([target])), attention);
});
