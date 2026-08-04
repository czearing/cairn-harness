import assert from "node:assert/strict";
import test from "node:test";
import { createCachedWorkerProcessResolver, type WorkerRecord } from "./worker-process-identity.ts";

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
