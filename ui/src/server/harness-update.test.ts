import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  autoUpdateDue,
  autoUpdateEnabled,
  autoUpdateIntervalMs,
  autoUpdateStatePath,
  fastForwardDecision,
  readAutoUpdateState,
  recordAutoUpdateResult,
  retryDelayMs,
  runHarnessUpdate,
} from "./harness-update.ts";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const state = (lastCheckTs: number, overrides: { consecutiveFailures?: number; nextCheckTs?: number } = {}) => ({
  lastCheckTs,
  lastRevision: "",
  lastStatus: "" as const,
  lastReason: "",
  consecutiveFailures: overrides.consecutiveFailures ?? 0,
  nextCheckTs: overrides.nextCheckTs ?? 0,
});

let dir = "";
const previousState = process.env.HARNESS_AUTO_UPDATE_STATE;
const previousInterval = process.env.HARNESS_AUTO_UPDATE_INTERVAL_MS;
const previousEnabled = process.env.HARNESS_AUTO_UPDATE;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harness-auto-update-"));
  process.env.HARNESS_AUTO_UPDATE_STATE = join(dir, "state.json");
  delete process.env.HARNESS_AUTO_UPDATE_INTERVAL_MS;
  delete process.env.HARNESS_AUTO_UPDATE;
});

afterEach(() => {
  if (previousState === undefined) delete process.env.HARNESS_AUTO_UPDATE_STATE;
  else process.env.HARNESS_AUTO_UPDATE_STATE = previousState;
  if (previousInterval === undefined) delete process.env.HARNESS_AUTO_UPDATE_INTERVAL_MS;
  else process.env.HARNESS_AUTO_UPDATE_INTERVAL_MS = previousInterval;
  if (previousEnabled === undefined) delete process.env.HARNESS_AUTO_UPDATE;
  else process.env.HARNESS_AUTO_UPDATE = previousEnabled;
  rmSync(dir, { recursive: true, force: true });
});

describe("harness auto-update throttle", () => {
  it("a never-checked machine is due immediately", () => {
    assert.equal(autoUpdateDue(state(0), 1_000, HOUR), true);
  });

  it("a recent check is not due again", () => {
    assert.equal(autoUpdateDue(state(10 * HOUR), 10 * HOUR + 60_000, HOUR), false);
  });

  it("the check becomes due once the interval elapses", () => {
    assert.equal(autoUpdateDue(state(10 * HOUR), 11 * HOUR, HOUR), true);
  });

  it("a future stamp from clock skew never wedges updates off", () => {
    assert.equal(autoUpdateDue(state(99 * HOUR), 10 * HOUR, HOUR), true);
  });

  it("the interval is configurable and rejects nonsense values", () => {
    assert.equal(autoUpdateIntervalMs(), 5 * MINUTE);
    process.env.HARNESS_AUTO_UPDATE_INTERVAL_MS = "45000";
    assert.equal(autoUpdateIntervalMs(), 45000);
    process.env.HARNESS_AUTO_UPDATE_INTERVAL_MS = "not-a-number";
    assert.equal(autoUpdateIntervalMs(), 5 * MINUTE);
  });

  it("is enabled by default and can be disabled either env way", () => {
    assert.equal(autoUpdateEnabled({}), true);
    assert.equal(autoUpdateEnabled({ HARNESS_AUTO_UPDATE: "0" }), false);
    assert.equal(autoUpdateEnabled({ HARNESS_DISABLE_AUTO_UPDATE: "1" }), false);
  });
});

describe("fast-forward policy", () => {
  const inputs = {
    gitCheckout: true,
    dirty: false,
    localHead: "aaa",
    remoteHead: "bbb",
    remoteIsDescendant: true,
  };

  it("a clean checkout behind origin is fast-forwarded", () => {
    assert.deepEqual(fastForwardDecision(inputs), { update: true, status: "updated", reason: "fast-forwarded to origin/master" });
  });

  it("a machine already on the published revision does nothing", () => {
    const result = fastForwardDecision({ ...inputs, remoteHead: "aaa" });
    assert.equal(result.update, false);
    assert.equal(result.status, "current");
  });

  it("uncommitted work on the harness checkout is never stashed or discarded", () => {
    const result = fastForwardDecision({ ...inputs, dirty: true });
    assert.deepEqual(result, { update: false, status: "skipped", reason: "local changes present" });
  });

  it("a diverged checkout stays manual", () => {
    const result = fastForwardDecision({ ...inputs, remoteIsDescendant: false });
    assert.equal(result.update, false);
    assert.equal(result.status, "skipped");
  });

  it("a non-git install is skipped rather than failed", () => {
    const result = fastForwardDecision({ ...inputs, gitCheckout: false });
    assert.equal(result.update, false);
    assert.equal(result.status, "skipped");
  });

  it("unresolvable revisions are reported as a failure", () => {
    const result = fastForwardDecision({ ...inputs, remoteHead: "" });
    assert.equal(result.update, false);
    assert.equal(result.status, "failed");
  });
});

describe("failure backoff", () => {
  it("a healthy check keeps the normal cadence", () => {
    assert.equal(retryDelayMs(0, HOUR), HOUR);
  });

  it("a failed check retries in a minute and doubles, never exceeding the interval", () => {
    assert.equal(retryDelayMs(1, HOUR), MINUTE);
    assert.equal(retryDelayMs(2, HOUR), 2 * MINUTE);
    assert.equal(retryDelayMs(3, HOUR), 4 * MINUTE);
    assert.equal(retryDelayMs(20, HOUR), HOUR);
  });

  it("the recorded result is readable for status reporting", () => {
    recordAutoUpdateResult({ status: "updated", from: "aaa", to: "bbb", reason: "fast-forwarded to origin/master" }, 42);
    assert.deepEqual(readAutoUpdateState(), {
      lastCheckTs: 42,
      lastRevision: "bbb",
      lastStatus: "updated",
      lastReason: "fast-forwarded to origin/master",
      consecutiveFailures: 0,
      nextCheckTs: 42 + 5 * MINUTE,
    });
  });

  it("a fetch failure schedules a fast retry instead of burning the interval", () => {
    recordAutoUpdateResult({ status: "failed", from: "aaa", to: "", reason: "fetch failed: network" }, 10 * HOUR);
    const after = readAutoUpdateState();
    assert.equal(after.consecutiveFailures, 1);
    assert.equal(after.nextCheckTs, 10 * HOUR + MINUTE);
  });

  it("a success clears the backoff so failures do not accumulate forever", () => {
    recordAutoUpdateResult({ status: "failed", from: "aaa", to: "", reason: "fetch failed" }, HOUR);
    recordAutoUpdateResult({ status: "failed", from: "aaa", to: "", reason: "fetch failed" }, 2 * HOUR);
    assert.equal(readAutoUpdateState().consecutiveFailures, 2);
    recordAutoUpdateResult({ status: "current", from: "aaa", to: "aaa", reason: "already up to date" }, 3 * HOUR);
    const healthy = readAutoUpdateState();
    assert.equal(healthy.consecutiveFailures, 0);
    assert.equal(healthy.nextCheckTs, 3 * HOUR + 5 * MINUTE);
  });

  it("a corrupt stamp reads as never-checked instead of throwing", () => {
    writeFileSync(autoUpdateStatePath(), "{not json");
    assert.equal(readAutoUpdateState().lastCheckTs, 0);
  });
});

const git = (cwd: string, ...args: string[]) => {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
};

describe("runHarnessUpdate against a real local origin", () => {
  it("reports current with nothing published since the clone", async () => {
    const origin = join(dir, "origin");
    const clone = join(dir, "clone");
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "--initial-branch=master", ".");
    writeFileSync(join(origin, "file.txt"), "v1");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "v1");
    git(dir, "clone", "--quiet", origin, clone);

    assert.equal((await runHarnessUpdate({ root: clone })).status, "current");
  });

  it("refuses to touch a checkout with uncommitted local work", async () => {
    const origin = join(dir, "origin");
    const clone = join(dir, "clone");
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "--initial-branch=master", ".");
    writeFileSync(join(origin, "file.txt"), "v1");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "v1");
    git(dir, "clone", "--quiet", origin, clone);

    writeFileSync(join(origin, "file.txt"), "v2");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "v2");
    writeFileSync(join(clone, "file.txt"), "local work in progress");

    const blocked = await runHarnessUpdate({ root: clone });
    assert.equal(blocked.status, "skipped");
    assert.equal(readFileSync(join(clone, "file.txt"), "utf8"), "local work in progress");
  });

  it("a plain directory is skipped without throwing", async () => {
    assert.equal((await runHarnessUpdate({ root: join(dir, "not-a-repo") })).status, "skipped");
  });
});
