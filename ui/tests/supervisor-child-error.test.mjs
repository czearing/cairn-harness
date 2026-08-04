import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, fstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ownsWorkerProcess as actualOwns,
  withOwnedWorker as actualWithOwned,
} from "../src/server/worker-process-identity.ts";

const childProcessShim = "test:supervisor-child-process";
const workerIdentityShim = "test:supervisor-child-identity";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node:child_process") return { url: childProcessShim, shortCircuit: true };
    if (specifier === "./worker-process-identity" && context.parentURL?.includes("/src/server/")) {
      return { url: workerIdentityShim, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === childProcessShim) return {
      format: "module", shortCircuit: true,
      source: `export const spawn = (...args) => globalThis.__childErrorSpawn(...args); export const spawnSync = () => ({ status: 0 });`,
    };
    if (url === workerIdentityShim) return {
      format: "module", shortCircuit: true,
      source: `
        export const createCachedWorkerProcessResolver = () => (record, config, read) => resolveWorkerProcess(record, config, read);
        export const ownsWorkerProcess = (record, read) => globalThis.__childErrorOwns(record, read);
        export const readProcessIdentity = (pid) => globalThis.__childErrorIdentity(pid);
        export const resolveWorkerProcess = () => null;
        export const withOwnedWorker = (record, action) => globalThis.__childErrorWithOwned(record, action);
      `,
    };
    return nextLoad(url, context);
  },
});

const { ensureProjectRunning } = await import("../src/server/supervisor.ts");

test("worker child errors are contained and clean only their own record", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-child-error-"));
  const projectDirectory = path.join(root, "project");
  const workspace = path.join(root, "workspace");
  const harnessDirectory = path.join(workspace, ".cairn-harness");
  const config = path.join(projectDirectory, "project.json");
  const record = path.join(harnessDirectory, "ui-worker.json");
  mkdirSync(projectDirectory);
  mkdirSync(harnessDirectory, { recursive: true });
  writeFileSync(config, JSON.stringify({
    name: "Child errors", root: workspace,
    roles: [{ name: "lead", description: "Lead", prompt: "Lead." }],
  }));
  const previous = new Map(["HARNESS_PROJECTS", "HARNESS_DISCOVER_EXAMPLES", "HARNESS_BIN", "HARNESS_ENABLE_SUPERVISOR"]
    .map((name) => [name, process.env[name]]));
  process.env.HARNESS_PROJECTS = config;
  process.env.HARNESS_DISCOVER_EXAMPLES = "0";
  process.env.HARNESS_BIN = "fake-worker";
  process.env.HARNESS_ENABLE_SUPERVISOR = "1";
  const identities = new Map();
  const children = [];
  const descriptors = [];
  const diagnostics = [];
  const originalError = console.error;
  globalThis.__childErrorIdentity = (pid) => identities.get(pid) || null;
  globalThis.__childErrorOwns = (value, read = globalThis.__childErrorIdentity) => actualOwns(value, read);
  globalThis.__childErrorWithOwned = (value, action) => actualWithOwned(value, action, globalThis.__childErrorIdentity);
  console.error = (...arguments_) => diagnostics.push(arguments_);
  context.after(() => {
    console.error = originalError;
    for (const [name, value] of previous) value === undefined ? delete process.env[name] : process.env[name] = value;
    delete globalThis.__childErrorSpawn;
    delete globalThis.__childErrorIdentity;
    delete globalThis.__childErrorOwns;
    delete globalThis.__childErrorWithOwned;
    rmSync(root, { recursive: true, force: true });
  });

  let nextChild = new FakeChild(undefined);
  globalThis.__childErrorSpawn = (_command, _args, options) => {
    descriptors.push(options.stdio[1]);
    children.push(nextChild);
    return nextChild;
  };
  assert.throws(() => ensureProjectRunning("project"), /Could not start worker for project/);
  assertClosed(descriptors.at(-1));
  assert.doesNotThrow(() => nextChild.emit("error", new Error("missing executable")));
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0][0], /Project worker failed for project/);

  nextChild = new FakeChild(6100);
  identities.set(6100, { start: "start-6100", command: "fake-worker" });
  assert.equal(ensureProjectRunning("project"), true);
  assertClosed(descriptors.at(-1));
  const replacement = { ...JSON.parse(readFileSync(record, "utf8")), pid: 6200, process: { start: "start-6200", command: "fake-worker" } };
  writeFileSync(record, JSON.stringify(replacement));
  nextChild.emit("error", new Error("late old-worker error"));
  assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), replacement);

  rmSync(record, { force: true });
  nextChild = new FakeChild(6300);
  identities.set(6300, { start: "start-6300", command: "fake-worker" });
  assert.equal(ensureProjectRunning("project"), true);
  nextChild.emit("error", new Error("owned-worker error"));
  assert.equal(existsSync(record), false);
  assert.equal(diagnostics.length, 3);

  nextChild = new FakeChild(6400);
  identities.set(6400, { start: "start-6400", command: "fake-worker" });
  assert.equal(ensureProjectRunning("project"), true);
  assert.equal(nextChild.unrefCalls, 1);
  assert.equal(existsSync(record), true);
  nextChild.emit("exit", 0);
  assert.equal(existsSync(record), false);

  const spawnError = new Error("synchronous spawn failure");
  globalThis.__childErrorSpawn = (_command, _args, options) => {
    descriptors.push(options.stdio[1]);
    throw spawnError;
  };
  assert.throws(() => ensureProjectRunning("project"), (error) => error === spawnError);
  assertClosed(descriptors.at(-1));
});

class FakeChild extends EventEmitter {
  constructor(pid) { super(); this.pid = pid; this.unrefCalls = 0; }
  kill() {}
  unref() { this.unrefCalls += 1; }
}

function assertClosed(descriptor) {
  assert.throws(() => fstatSync(descriptor), { code: "EBADF" });
}
