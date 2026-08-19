import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Every machine running the harness keeps ITSELF current: instrumentation.ts polls this on a
// fixed interval so a human never has to git pull + cargo build + restart by hand on each
// computer. A clean, fast-forwardable checkout is fetched, the release binary is rebuilt, and
// every running project is stopped (to free the locked .exe on Windows) and restarted on the
// new binary. Dirty or diverged checkouts are left alone — a developer's work in progress on
// this repo is never stashed, rebased, or discarded behind their back.
//
// A `git fetch` against this repo measures ~1.1s (see the harness auto-update Brain node), so a
// tight poll costs nothing worth trading away: PUBLISH_LATENCY_MS is how long a pushed commit can
// sit unpicked-up on another machine, and RETRY_MS is how often a transient fetch failure (no
// network, a blocked port) is retried without waiting out the full interval.
const PUBLISH_LATENCY_MS = 30_000;
const RETRY_MS = 5_000;

export type HarnessUpdateStatus = "updated" | "current" | "skipped" | "failed";

export interface HarnessUpdateState {
  lastCheckTs: number;
  lastRevision: string;
  lastStatus: HarnessUpdateStatus | "";
  lastReason: string;
  consecutiveFailures: number;
  nextCheckTs: number;
}

export interface HarnessUpdateResult {
  status: HarnessUpdateStatus;
  from: string;
  to: string;
  reason: string;
}

interface FastForwardInputs {
  gitCheckout: boolean;
  dirty: boolean;
  localHead: string;
  remoteHead: string;
  remoteIsDescendant: boolean;
}

export function harnessRepoRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");
}

export function defaultAutoUpdateStatePath(root: string): string {
  return path.join(root, ".git", "harness-auto-update-state.json");
}

export function readAutoUpdateState(statePath: string): HarnessUpdateState {
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<HarnessUpdateState>;
    return {
      lastCheckTs: Number(parsed.lastCheckTs || 0),
      lastRevision: String(parsed.lastRevision || ""),
      lastStatus: (parsed.lastStatus || "") as HarnessUpdateState["lastStatus"],
      lastReason: String(parsed.lastReason || ""),
      consecutiveFailures: Number(parsed.consecutiveFailures || 0),
      nextCheckTs: Number(parsed.nextCheckTs || 0),
    };
  } catch {
    return {
      lastCheckTs: 0, lastRevision: "", lastStatus: "", lastReason: "",
      consecutiveFailures: 0, nextCheckTs: 0,
    };
  }
}

function writeAutoUpdateState(statePath: string, state: HarnessUpdateState): void {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state));
}

/** Pure backoff: a transient failure (no network, a blocked fetch) retries in RETRY_MS and
 *  doubles from there, but never waits longer than the normal interval. */
export function retryDelayMs(consecutiveFailures: number, intervalMs: number): number {
  if (consecutiveFailures <= 0) return intervalMs;
  return Math.min(intervalMs, RETRY_MS * 2 ** (consecutiveFailures - 1));
}

/** Pure throttle: a check is due once its scheduled time arrives, and always on a first or
 *  clock-skewed run. */
export function autoUpdateDue(state: HarnessUpdateState, now: number, intervalMs: number): boolean {
  if (!state.lastCheckTs) return true;
  if (state.lastCheckTs > now) return true;
  const due = state.nextCheckTs || state.lastCheckTs + intervalMs;
  return now >= due;
}

/** Pure policy: only a clean checkout that origin strictly moved ahead of is fast-forwarded. */
export function fastForwardDecision(inputs: FastForwardInputs): { update: boolean; status: HarnessUpdateStatus; reason: string } {
  if (!inputs.gitCheckout) return { update: false, status: "skipped", reason: "not a git checkout" };
  if (inputs.dirty) return { update: false, status: "skipped", reason: "local changes present" };
  if (!inputs.localHead || !inputs.remoteHead) return { update: false, status: "failed", reason: "could not resolve revisions" };
  if (inputs.localHead === inputs.remoteHead) return { update: false, status: "current", reason: "already up to date" };
  if (!inputs.remoteIsDescendant) return { update: false, status: "skipped", reason: "checkout diverged from origin/master" };
  return { update: true, status: "updated", reason: "fast-forwarded to origin/master" };
}

// Runs off the event loop. `git fetch` reaches the network and previously ran through
// spawnSync, which froze the entire Node process -- every HTTP request, SSE tick and API call
// stalled for the whole duration of the fetch, measured at over 5s on a slow network. Nothing
// here needs to be synchronous: runHarnessUpdate is already async.
async function sh(command: string, args: string[], cwd: string) {
  try {
    const run = await execFileAsync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, out: (run.stdout || "").trim(), err: (run.stderr || "").trim() };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, out: (failure.stdout || "").trim(), err: (failure.stderr || "").trim() };
  }
}

/** Whether path (relative to root) changed between two revisions — used so a UI dependency
 *  install only runs when the lockfile actually moved, instead of on every single update. */
async function pathChanged(root: string, from: string, to: string, relativePath: string): Promise<boolean> {
  if (!from || from === to) return false;
  return (await sh("git", ["diff", "--name-only", `${from}..${to}`, "--", relativePath], root)).out.length > 0;
}

export async function runHarnessUpdate(options: { root?: string } = {}): Promise<HarnessUpdateResult> {
  const root = options.root || harnessRepoRoot();
  if (!existsSync(path.join(root, ".git"))) {
    return { status: "skipped", from: "", to: "", reason: "not a git checkout" };
  }
  const localHead = (await sh("git", ["rev-parse", "HEAD"], root)).out;
  const dirty = (await sh("git", ["status", "--porcelain", "--untracked-files=no"], root)).out.length > 0;
  const fetch = await sh("git", ["fetch", "--quiet", "origin", "master"], root);
  if (!fetch.ok) {
    return { status: "failed", from: localHead, to: "", reason: `fetch failed: ${fetch.err.split("\n")[0] || ""}` };
  }
  const remoteHead = (await sh("git", ["rev-parse", "FETCH_HEAD"], root)).out;
  const decision = fastForwardDecision({
    gitCheckout: true,
    dirty,
    localHead,
    remoteHead,
    remoteIsDescendant: (await sh("git", ["merge-base", "--is-ancestor", localHead, remoteHead], root)).ok,
  });
  if (!decision.update) {
    return { status: decision.status, from: localHead, to: remoteHead, reason: decision.reason };
  }

  const uiDependenciesChanged = await pathChanged(root, localHead, remoteHead, "ui/package-lock.json");
  // Loaded lazily and only on this branch: the supervisor module's own local imports rely on
  // Next.js's bundler for extensionless resolution, so keeping this out of harness-update's
  // top-level imports means the "current"/"skipped"/"not a repo" paths above stay resolvable
  // under a plain `node --test` run, with no unrelated files touched to make that so.
  const { startAllProjects, stopAllProjects } = await import("./supervisor.ts");
  let stopped = false;
  try {
    stopAllProjects();
    stopped = true;
    const merge = await sh("git", ["merge", "--ff-only", remoteHead], root);
    if (!merge.ok) {
      return { status: "failed", from: localHead, to: remoteHead, reason: `fast-forward failed: ${merge.err.split("\n")[0] || ""}` };
    }
    const build = await sh("cargo", ["build", "--release"], root);
    if (!build.ok) {
      return { status: "failed", from: localHead, to: remoteHead, reason: `build failed: ${build.err.trim().split("\n").slice(-1)[0] || ""}` };
    }
    if (uiDependenciesChanged) {
      const install = await sh("npm", ["ci"], path.join(root, "ui"));
      if (!install.ok) {
        return { status: "failed", from: localHead, to: remoteHead, reason: `npm ci failed: ${install.err.trim().split("\n").slice(-1)[0] || ""}` };
      }
    }
    return { status: "updated", from: localHead, to: remoteHead, reason: decision.reason };
  } finally {
    // Always resume, even on a failed merge/build, so a broken update never leaves every
    // project down: startAllProjects() is a no-op for anything the user paused themselves.
    if (stopped) startAllProjects();
  }
}

export function recordAutoUpdateResult(statePath: string, result: HarnessUpdateResult, now = Date.now()): void {
  const prior = readAutoUpdateState(statePath);
  // Only a hard failure backs off. "skipped" is a standing condition (dirty checkout, not a git
  // checkout) that a fast retry cannot clear, so it keeps the normal cadence.
  const consecutiveFailures = result.status === "failed" ? prior.consecutiveFailures + 1 : 0;
  writeAutoUpdateState(statePath, {
    lastCheckTs: now,
    lastRevision: result.to || result.from,
    lastStatus: result.status,
    lastReason: result.reason,
    consecutiveFailures,
    nextCheckTs: now + retryDelayMs(consecutiveFailures, PUBLISH_LATENCY_MS),
  });
}

/** Poll entry point: called every RETRY_MS from instrumentation.ts so a backoff retry is never
 *  missed, but real git/build work only happens once autoUpdateDue() says a check is actually
 *  due. Runs in the same Node process as the UI server, but every git/build command is spawned
 *  asynchronously so a slow network fetch never blocks the event loop and stalls the UI. */
export async function maybeCheckForHarnessUpdate(options: { root?: string; statePath?: string } = {}, now = Date.now()): Promise<HarnessUpdateResult | null> {
  const root = options.root || harnessRepoRoot();
  const statePath = options.statePath || defaultAutoUpdateStatePath(root);
  const state = readAutoUpdateState(statePath);
  if (!autoUpdateDue(state, now, PUBLISH_LATENCY_MS)) return null;
  const result = await runHarnessUpdate({ root });
  recordAutoUpdateResult(statePath, result, now);
  return result;
}

export const harnessUpdatePollMs = RETRY_MS;
