import assert from "node:assert/strict";
import test from "node:test";
import { createCachedWorkerProcessResolver, ownsWorkerProcess, readProcessIdentity, resolveWorkerProcess, withOwnedWorker } from "../src/server/worker-process-identity.ts";

const identity = { start: "launch-1", command: "[\"cairn-harness\",\"watch\"]" };
const record = {
  pid: 42,
  config: "C:\\project\\project.json",
  startedAt: "2026-07-15T16:00:00.000Z",
  log: "C:\\workspace\\.cairn-harness\\worker.log",
  process: identity,
};

test("worker ownership requires matching observable start and command identity", () => {
  assert.equal(ownsWorkerProcess(record, () => identity), true);
  assert.equal(ownsWorkerProcess(record, () => ({ ...identity, start: "launch-2" })), false);
  assert.equal(ownsWorkerProcess(record, () => ({ ...identity, command: "[\"other\"]" })), false);
  assert.equal(ownsWorkerProcess(record, () => null), false);
});

test("worker ownership fails closed for legacy and malformed records", () => {
  const legacy = { pid: 42, config: record.config, startedAt: record.startedAt, log: record.log };
  assert.equal(ownsWorkerProcess(legacy, () => identity), false);
  assert.equal(ownsWorkerProcess({ ...record, pid: 0 }, () => identity), false);
  assert.equal(ownsWorkerProcess({ ...record, process: { start: "", command: identity.command } }, () => identity), false);
  assert.equal(ownsWorkerProcess(null, () => identity), false);
});

test("legacy records upgrade only when the live command matches their exact config", () => {
  const legacy = { pid: 42, config: record.config, startedAt: record.startedAt, log: record.log };
  const live = { start: "launch-1", command: `"cairn-harness.exe" --config ${record.config} watch` };
  assert.deepEqual(resolveWorkerProcess(legacy, record.config, () => live), { ...legacy, process: live });
  assert.equal(resolveWorkerProcess(legacy, "C:\\other\\project.json", () => live), null);
  assert.equal(resolveWorkerProcess(legacy, record.config, () => ({ ...live, command: "unrelated.exe watch" })), null);
});

test("warm worker resolution launches zero identity readers while stale records are reverified", () => {
  let identityReads = 0;
  let alive = true;
  const resolveCached = createCachedWorkerProcessResolver(() => alive);
  const readIdentity = () => {
    identityReads += 1;
    return identity;
  };

  assert.equal(resolveCached(record, record.config, readIdentity)?.pid, record.pid);
  assert.equal(identityReads, 1);
  assert.equal(resolveCached({ ...record }, record.config, () => {
    throw new Error("warm resolution must not launch powershell.exe/Get-CimInstance");
  })?.pid, record.pid);
  assert.equal(identityReads, 1);

  alive = false;
  assert.equal(resolveCached(record, record.config, readIdentity)?.pid, record.pid);
  assert.equal(identityReads, 2);
  assert.equal(resolveCached(record, "C:\\other\\project.json", readIdentity), null);
});

test("signed worker verification survives resolver isolation without weakening record checks", () => {
  const firstResolver = createCachedWorkerProcessResolver(() => true);
  const signed = firstResolver(record, record.config, () => identity);
  assert.ok(signed?.verification);

  const isolatedResolver = createCachedWorkerProcessResolver(() => true);
  assert.equal(isolatedResolver(signed, record.config, () => {
    throw new Error("signed warm resolution must not read process identity");
  })?.pid, record.pid);
  assert.equal(isolatedResolver(signed, "C:\\other\\project.json", () => {
    throw new Error("config mismatch must fail before reading process identity");
  }), null);

  let identityReads = 0;
  assert.equal(isolatedResolver({ ...signed, process: { ...identity, start: "tampered" } }, record.config, () => {
    identityReads += 1;
    return identity;
  }), null);
  assert.equal(identityReads, 1);
  assert.equal(isolatedResolver({ ...signed, config: "C:\\other\\project.json" }, record.config, () => {
    identityReads += 1;
    return identity;
  }), null);
  assert.equal(identityReads, 1);
});

test("only an owned worker authorizes process termination", () => {
  const terminated = [];
  assert.equal(withOwnedWorker(record, (owned) => terminated.push(owned.pid), () => identity), true);
  assert.equal(withOwnedWorker(record, (owned) => terminated.push(owned.pid), () => ({ ...identity, start: "launch-2" })), false);
  assert.equal(withOwnedWorker(record, (owned) => terminated.push(owned.pid), () => null), false);
  assert.deepEqual(terminated, [42]);
});

test("current process identity is observable and stable", () => {
  const first = readProcessIdentity(process.pid);
  const second = readProcessIdentity(process.pid);
  assert.ok(first);
  assert.deepEqual(second, first);
});
