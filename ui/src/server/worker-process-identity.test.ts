import assert from "node:assert/strict";
import test from "node:test";
import { createCachedWorkerProcessResolver, findRunningWorkerProcess, type ProcessIdentity, type WorkerRecord } from "./worker-process-identity.ts";

const config = "C:\\projects\\sample\\project.json";
const record: WorkerRecord = {
  pid: 42,
  config,
  startedAt: "2026-07-30T00:00:00Z",
  log: "C:\\projects\\sample\\worker.log",
  process: {
    start: "2026-07-30T00:00:00Z",
    command: `cairn-harness.exe --config ${config} watch`,
  },
};

test("cached worker records avoid repeated identity probes within the bounded window", () => {
  let identity = record.process;
  const resolve = createCachedWorkerProcessResolver(() => true);
  assert.ok(resolve(record, config, () => identity, () => identity.start));

  identity = {
    start: "2026-07-30T01:00:00Z",
    command: "unrelated.exe",
  };
  assert.equal(resolve(record, config, () => identity, () => identity.start), record);
});

test("signed records reject reused process ids on a cold resolver", () => {
  let identity = record.process;
  const first = createCachedWorkerProcessResolver(() => true);
  const signed = first(record, config, () => identity, () => identity.start);
  assert.ok(signed?.verification);

  identity = {
    start: "2026-07-30T01:00:00Z",
    command: "unrelated.exe",
  };
  const restarted = createCachedWorkerProcessResolver(() => true);
  assert.equal(restarted(signed, config, () => identity, () => identity.start), null);
});

test("findRunningWorkerProcess detects an already-running watch loop with no tracking record", () => {
  const identities: Record<number, ProcessIdentity> = {
    111: { start: "2026-07-30T00:00:00Z", command: "unrelated.exe" },
    222: { start: "2026-07-30T00:00:00Z", command: `cairn-harness.exe --config ${config} watch` },
  };
  const found = findRunningWorkerProcess(
    config,
    () => [111, 222],
    (pid) => identities[pid] ?? null,
  );

  assert.deepEqual(found, { pid: 222, process: identities[222] });
});

test("findRunningWorkerProcess ignores watch loops for a different project", () => {
  const identities: Record<number, ProcessIdentity> = {
    333: { start: "2026-07-30T00:00:00Z", command: "cairn-harness.exe --config C:\\projects\\other\\project.json watch" },
  };
  const found = findRunningWorkerProcess(
    config,
    () => [333],
    (pid) => identities[pid] ?? null,
  );

  assert.equal(found, null);
});

test("findRunningWorkerProcess ignores non-watch cairn-harness processes such as short-lived mcp subprocesses", () => {
  const identities: Record<number, ProcessIdentity> = {
    444: { start: "2026-07-30T00:00:00Z", command: "cairn-harness.exe mcp" },
  };
  const found = findRunningWorkerProcess(
    config,
    () => [444],
    (pid) => identities[pid] ?? null,
  );

  assert.equal(found, null);
});

test("findRunningWorkerProcess returns null when no candidate processes are running", () => {
  assert.equal(findRunningWorkerProcess(config, () => [], () => null), null);
});
