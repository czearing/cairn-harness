import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ownsWorkerProcess as actualOwnsWorkerProcess,
  resolveWorkerProcess as actualResolveWorkerProcess,
  withOwnedWorker as actualWithOwnedWorker,
} from "../src/server/worker-process-identity.ts";

const childProcessShim = "test:worker-child-process";
const workerIdentityShim = "test:worker-process-identity";
globalThis.__workerOwnershipCacheCreations = 0;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node:child_process") return { url: childProcessShim, shortCircuit: true };
    if (specifier === "./worker-process-identity"
      && context.parentURL?.includes("/src/server/")) {
      return { url: workerIdentityShim, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === childProcessShim) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export const spawn = (...arguments_) => globalThis.__workerOwnershipSpawn(...arguments_);
          export const spawnSync = (...arguments_) => globalThis.__workerOwnershipSpawnSync(...arguments_);
        `,
      };
    }
    if (url === workerIdentityShim) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export const createCachedWorkerProcessResolver = () => {
            globalThis.__workerOwnershipCacheCreations += 1;
            return (record, config, read) => resolveWorkerProcess(record, config, read);
          };
          export const ownsWorkerProcess = (record) => globalThis.__workerOwnershipOwns(record);
          export const readProcessIdentity = (pid) => globalThis.__workerOwnershipReadIdentity(pid);
          export const resolveWorkerProcess = (record, config) => globalThis.__workerOwnershipResolve(record, config);
          export const withOwnedWorker = (record, action) => globalThis.__workerOwnershipWithOwned(record, action);
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const { getHealth } = await import("../src/server/health.ts");
const { ensureProjectRunning, pauseProject, resumeProject } = await import("../src/server/supervisor.ts");

test("health, ensure, and stop require the same owned worker identity", (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-worker-ownership-"));
  const previousEnvironment = new Map([
    ["HARNESS_PROJECT_ROOT", process.env.HARNESS_PROJECT_ROOT],
    ["HARNESS_PROJECTS", process.env.HARNESS_PROJECTS],
    ["HARNESS_DISCOVER_EXAMPLES", process.env.HARNESS_DISCOVER_EXAMPLES],
    ["HARNESS_BIN", process.env.HARNESS_BIN],
    ["HARNESS_ENABLE_SUPERVISOR", process.env.HARNESS_ENABLE_SUPERVISOR],
    ["HARNESS_DISABLE_SUPERVISOR", process.env.HARNESS_DISABLE_SUPERVISOR],
  ]);
  const originalKill = process.kill;
  context.after(() => {
    process.kill = originalKill;
    for (const [name, value] of previousEnvironment) restoreEnvironment(name, value);
    delete globalThis.__workerOwnershipSpawn;
    delete globalThis.__workerOwnershipSpawnSync;
    delete globalThis.__workerOwnershipOwns;
    delete globalThis.__workerOwnershipReadIdentity;
    delete globalThis.__workerOwnershipResolve;
    delete globalThis.__workerOwnershipWithOwned;
    delete globalThis.__workerOwnershipCacheCreations;
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  const managedRoot = path.join(fixtureRoot, "managed-projects");
  const projectDirectory = path.join(fixtureRoot, "owned-project");
  const workspace = path.join(fixtureRoot, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const configPath = path.join(projectDirectory, "project.json");
  const recordPath = path.join(harnessDirectory, "ui-worker.json");
  mkdirSync(managedRoot, { recursive: true });
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    name: "Owned worker project",
    root: workspace,
    roles: [{ name: "lead", description: "Project lead", prompt: "Lead." }],
  }));
  process.env.HARNESS_PROJECT_ROOT = managedRoot;
  process.env.HARNESS_PROJECTS = configPath;
  process.env.HARNESS_DISCOVER_EXAMPLES = "0";
  process.env.HARNESS_BIN = "fake-worker";
  process.env.HARNESS_ENABLE_SUPERVISOR = "1";
  delete process.env.HARNESS_DISABLE_SUPERVISOR;
  assert.equal(globalThis.__workerOwnershipCacheCreations, 2);

  const identities = new Map([
    [4100, { start: "actual-unrelated-start", command: "[\"unrelated\"]" }],
    [5100, { start: "spawned-start", command: `"cairn-harness.exe" --config ${configPath} watch` }],
  ]);
  const spawns = [];
  const taskkills = [];
  const processKills = [];
  let identityReads = 0;
  globalThis.__workerOwnershipReadIdentity = (pid) => {
    identityReads += 1;
    return identities.get(pid) || null;
  };
  globalThis.__workerOwnershipOwns = (record) =>
    actualOwnsWorkerProcess(record, globalThis.__workerOwnershipReadIdentity);
  globalThis.__workerOwnershipResolve = (record, config) =>
    actualResolveWorkerProcess(record, config, globalThis.__workerOwnershipReadIdentity);
  globalThis.__workerOwnershipWithOwned = (record, action) =>
    actualWithOwnedWorker(record, action, globalThis.__workerOwnershipReadIdentity);
  globalThis.__workerOwnershipSpawn = (command, args) => {
    spawns.push({ command, args });
    return {
      pid: 5100,
      kill() { processKills.push({ pid: 5100, signal: "child.kill" }); },
      once() {},
      unref() {},
    };
  };
  globalThis.__workerOwnershipSpawnSync = (command, args) => {
    taskkills.push({ command, args });
    return { status: 0 };
  };
  process.kill = (pid, signal) => {
    processKills.push({ pid, signal });
    return true;
  };
  const mismatchedRecord = {
    pid: 4100,
    config: configPath,
    startedAt: "2026-07-15T16:00:00.000Z",
    log: path.join(harnessDirectory, "worker.log"),
    process: { start: "recorded-worker-start", command: "[\"fake-worker\",\"watch\"]" },
  };

  for (const staleRecord of [
    mismatchedRecord,
    { ...mismatchedRecord, pid: 4200 },
    { ...mismatchedRecord, process: undefined },
    { ...mismatchedRecord, pid: "invalid" },
  ]) {
    writeFileSync(recordPath, JSON.stringify(staleRecord));
    assert.equal(getHealth().status, "attention");
    assert.equal(getHealth().issues[0].summary, "Agent worker is not running");
  }
  writeFileSync(recordPath, JSON.stringify(mismatchedRecord));
  pauseProject("owned-project");
  assert.equal(taskkills.length, 0);
  assert.equal(processKills.length, 0);

  resumeProject("owned-project");
  assert.equal(spawns.length, 1);
  const recoveredRecord = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(recoveredRecord.pid, 5100);
  assert.deepEqual(recoveredRecord.process, identities.get(5100));
  assert.equal(getHealth().status, "healthy");
  identityReads = 0;
  assert.equal(ensureProjectRunning("owned-project"), true);
  assert.equal(identityReads, 1);
  assert.equal(spawns.length, 1);

  writeFileSync(recordPath, JSON.stringify({
    pid: recoveredRecord.pid,
    config: recoveredRecord.config,
    startedAt: recoveredRecord.startedAt,
    log: recoveredRecord.log,
  }));
  identityReads = 0;
  assert.equal(ensureProjectRunning("owned-project"), true);
  assert.equal(identityReads, 1);
  assert.deepEqual(JSON.parse(readFileSync(recordPath, "utf8")), recoveredRecord);
  assert.equal(spawns.length, 1);

  pauseProject("owned-project");
  assert.equal(taskkills.length, 1);
  assert.deepEqual(taskkills[0].args, ["/PID", "5100", "/T", "/F"]);
  assert.equal(processKills.length, 0);
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
