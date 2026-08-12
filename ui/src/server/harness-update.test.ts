import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  autoUpdateDue,
  defaultAutoUpdateStatePath,
  fastForwardDecision,
  harnessUpdatePollMs,
  maybeCheckForHarnessUpdate,
  readAutoUpdateState,
  recordAutoUpdateResult,
  retryDelayMs,
  runHarnessUpdate,
} from "./harness-update.ts";

const PUBLISH_LATENCY_MS = 30_000;
const RETRY_MS = 5_000;

const state = (lastCheckTs: number, overrides: { consecutiveFailures?: number; nextCheckTs?: number } = {}) => ({
  lastCheckTs,
  lastRevision: "",
  lastStatus: "" as const,
  lastReason: "",
  consecutiveFailures: overrides.consecutiveFailures ?? 0,
  nextCheckTs: overrides.nextCheckTs ?? 0,
});

let dir = "";
let statePath = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harness-auto-update-"));
  statePath = join(dir, "state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("harness auto-update throttle", () => {
  it("a never-checked machine is due immediately", () => {
    assert.equal(autoUpdateDue(state(0), 1_000, PUBLISH_LATENCY_MS), true);
  });

  it("a recent check is not due again", () => {
    assert.equal(autoUpdateDue(state(10 * PUBLISH_LATENCY_MS), 10 * PUBLISH_LATENCY_MS + 1_000, PUBLISH_LATENCY_MS), false);
  });

  it("the check becomes due once the interval elapses", () => {
    assert.equal(autoUpdateDue(state(10 * PUBLISH_LATENCY_MS), 11 * PUBLISH_LATENCY_MS, PUBLISH_LATENCY_MS), true);
  });

  it("a future stamp from clock skew never wedges updates off", () => {
    assert.equal(autoUpdateDue(state(99 * PUBLISH_LATENCY_MS), 10 * PUBLISH_LATENCY_MS, PUBLISH_LATENCY_MS), true);
  });

  it("the poll rate is tighter than the publish-latency interval so a backoff retry is never missed", () => {
    assert.equal(harnessUpdatePollMs, RETRY_MS);
    assert.ok(harnessUpdatePollMs < PUBLISH_LATENCY_MS);
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
    assert.equal(retryDelayMs(0, PUBLISH_LATENCY_MS), PUBLISH_LATENCY_MS);
  });

  it("a failed check retries in RETRY_MS and doubles, never exceeding the interval", () => {
    assert.equal(retryDelayMs(1, PUBLISH_LATENCY_MS), RETRY_MS);
    assert.equal(retryDelayMs(2, PUBLISH_LATENCY_MS), 2 * RETRY_MS);
    assert.equal(retryDelayMs(3, PUBLISH_LATENCY_MS), 4 * RETRY_MS);
    assert.equal(retryDelayMs(20, PUBLISH_LATENCY_MS), PUBLISH_LATENCY_MS);
  });

  it("the recorded result is readable for status reporting", () => {
    recordAutoUpdateResult(statePath, { status: "updated", from: "aaa", to: "bbb", reason: "fast-forwarded to origin/master" }, 42);
    assert.deepEqual(readAutoUpdateState(statePath), {
      lastCheckTs: 42,
      lastRevision: "bbb",
      lastStatus: "updated",
      lastReason: "fast-forwarded to origin/master",
      consecutiveFailures: 0,
      nextCheckTs: 42 + PUBLISH_LATENCY_MS,
    });
  });

  it("a fetch failure schedules a fast retry instead of burning the interval", () => {
    recordAutoUpdateResult(statePath, { status: "failed", from: "aaa", to: "", reason: "fetch failed: network" }, 10 * PUBLISH_LATENCY_MS);
    const after = readAutoUpdateState(statePath);
    assert.equal(after.consecutiveFailures, 1);
    assert.equal(after.nextCheckTs, 10 * PUBLISH_LATENCY_MS + RETRY_MS);
  });

  it("a success clears the backoff so failures do not accumulate forever", () => {
    recordAutoUpdateResult(statePath, { status: "failed", from: "aaa", to: "", reason: "fetch failed" }, PUBLISH_LATENCY_MS);
    recordAutoUpdateResult(statePath, { status: "failed", from: "aaa", to: "", reason: "fetch failed" }, 2 * PUBLISH_LATENCY_MS);
    assert.equal(readAutoUpdateState(statePath).consecutiveFailures, 2);
    recordAutoUpdateResult(statePath, { status: "current", from: "aaa", to: "aaa", reason: "already up to date" }, 3 * PUBLISH_LATENCY_MS);
    const healthy = readAutoUpdateState(statePath);
    assert.equal(healthy.consecutiveFailures, 0);
    assert.equal(healthy.nextCheckTs, 3 * PUBLISH_LATENCY_MS + PUBLISH_LATENCY_MS);
  });

  it("a corrupt stamp reads as never-checked instead of throwing", () => {
    writeFileSync(statePath, "{not json");
    assert.equal(readAutoUpdateState(statePath).lastCheckTs, 0);
  });

  it("the default state path lives inside the checkout's own .git directory", () => {
    assert.equal(defaultAutoUpdateStatePath(dir), join(dir, ".git", "harness-auto-update-state.json"));
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

describe("maybeCheckForHarnessUpdate end to end", () => {
  it("checks, records state, and then throttles until the interval elapses", async () => {
    const origin = join(dir, "origin");
    const clone = join(dir, "clone");
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "--initial-branch=master", ".");
    writeFileSync(join(origin, "file.txt"), "v1");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "v1");
    git(dir, "clone", "--quiet", origin, clone);

    const first = await maybeCheckForHarnessUpdate({ root: clone, statePath }, 1_000);
    assert.equal(first?.status, "current");
    assert.equal(readAutoUpdateState(statePath).lastCheckTs, 1_000);

    // Still inside the publish-latency window: a second call this soon does no git work at all.
    const second = await maybeCheckForHarnessUpdate({ root: clone, statePath }, 1_000 + RETRY_MS);
    assert.equal(second, null);

    const third = await maybeCheckForHarnessUpdate({ root: clone, statePath }, 1_000 + PUBLISH_LATENCY_MS);
    assert.equal(third?.status, "current");
  });
});
