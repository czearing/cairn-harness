import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Every machine running the harness keeps ITSELF current: instrumentation.ts polls this on an
// interval so a human never has to git pull + cargo build + restart by hand on each computer.
// A clean, fast-forwardable checkout is fetched, the release binary is rebuilt, and every
// running project is stopped (to free the locked .exe on Windows) and restarted on the new
// binary. Dirty or diverged checkouts are left alone — a developer's work in progress on this
// repo is never stashed, rebased, or discarded behind their back.

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_BASE_MS = 60 * 1000;

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
  return process.env.HARNESS_REPO_ROOT
    || path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");
}

export function autoUpdateStatePath(): string {
  return process.env.HARNESS_AUTO_UPDATE_STATE
    || path.join(harnessRepoRoot(), ".git", "harness-auto-update-state.json");
}

export function autoUpdateEnabled(environment: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return environment.HARNESS_AUTO_UPDATE !== "0" && environment.HARNESS_DISABLE_AUTO_UPDATE !== "1";
}

export function autoUpdateIntervalMs(environment: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(environment.HARNESS_AUTO_UPDATE_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 30_000 ? configured : DEFAULT_INTERVAL_MS;
}

export function readAutoUpdateState(): HarnessUpdateState {
  try {
    const parsed = JSON.parse(readFileSync(autoUpdateStatePath(), "utf8")) as Partial<HarnessUpdateState>;
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

function writeAutoUpdateState(state: HarnessUpdateState): void {
  const file = autoUpdateStatePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

/** Pure backoff: a transient failure (no network, a blocked fetch) must not cost a whole interval
 *  of update latency, but a persistently broken checkout must not be retried every poll either. */
export function retryDelayMs(consecutiveFailures: number, intervalMs: number): number {
  if (consecutiveFailures <= 0) return intervalMs;
  const backoff = RETRY_BASE_MS * 2 ** (consecutiveFailures - 1);
  return Math.min(intervalMs, backoff);
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

function sh(command: string, args: string[], cwd: string) {
  const run = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  return { ok: run.status === 0, out: (run.stdout || "").trim(), err: (run.stderr || "").trim() };
}

/** Whether path (relative to root) changed between two revisions — used so a UI dependency
 *  install only runs when the lockfile actually moved, instead of on every single update. */
function pathChanged(root: string, from: string, to: string, relativePath: string): boolean {
  if (!from || from === to) return false;
  return sh("git", ["diff", "--name-only", `${from}..${to}`, "--", relativePath], root).out.length > 0;
}

export async function runHarnessUpdate(options: { root?: string } = {}): Promise<HarnessUpdateResult> {
  const root = options.root || harnessRepoRoot();
  if (!existsSync(path.join(root, ".git"))) {
    return { status: "skipped", from: "", to: "", reason: "not a git checkout" };
  }
  const localHead = sh("git", ["rev-parse", "HEAD"], root).out;
  const dirty = sh("git", ["status", "--porcelain", "--untracked-files=no"], root).out.length > 0;
  const fetch = sh("git", ["fetch", "--quiet", "origin", "master"], root);
  if (!fetch.ok) {
    return { status: "failed", from: localHead, to: "", reason: `fetch failed: ${fetch.err.split("\n")[0] || ""}` };
  }
  const remoteHead = sh("git", ["rev-parse", "FETCH_HEAD"], root).out;
  const decision = fastForwardDecision({
    gitCheckout: true,
    dirty,
    localHead,
    remoteHead,
    remoteIsDescendant: sh("git", ["merge-base", "--is-ancestor", localHead, remoteHead], root).ok,
  });
  if (!decision.update) {
    return { status: decision.status, from: localHead, to: remoteHead, reason: decision.reason };
  }

  const uiDependenciesChanged = pathChanged(root, localHead, remoteHead, "ui/package-lock.json");
  // Loaded lazily and only on this branch: the supervisor module's own local imports rely on
  // Next.js's bundler for extensionless resolution, so keeping this out of harness-update's
  // top-level imports means the "current"/"skipped"/"not a repo" paths above stay resolvable
  // under a plain `node --test` run, with no unrelated files touched to make that so.
  const { startAllProjects, stopAllProjects } = await import("./supervisor.ts");
  let stopped = false;
  try {
    stopAllProjects();
    stopped = true;
    const merge = sh("git", ["merge", "--ff-only", remoteHead], root);
    if (!merge.ok) {
      return { status: "failed", from: localHead, to: remoteHead, reason: `fast-forward failed: ${merge.err.split("\n")[0] || ""}` };
    }
    const build = sh("cargo", ["build", "--release"], root);
    if (!build.ok) {
      return { status: "failed", from: localHead, to: remoteHead, reason: `build failed: ${build.err.trim().split("\n").slice(-1)[0] || ""}` };
    }
    if (uiDependenciesChanged) {
      const install = sh("npm", ["ci"], path.join(root, "ui"));
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

export function recordAutoUpdateResult(result: HarnessUpdateResult, now = Date.now()): void {
  const prior = readAutoUpdateState();
  const interval = autoUpdateIntervalMs();
  // Only a hard failure backs off. "skipped" is a standing condition (dirty checkout, not a git
  // checkout) that a fast retry cannot clear, so it keeps the normal cadence.
  const consecutiveFailures = result.status === "failed" ? prior.consecutiveFailures + 1 : 0;
  writeAutoUpdateState({
    lastCheckTs: now,
    lastRevision: result.to || result.from,
    lastStatus: result.status,
    lastReason: result.reason,
    consecutiveFailures,
    nextCheckTs: now + retryDelayMs(consecutiveFailures, interval),
  });
}

/** Poll entry point: called on an interval from instrumentation.ts. Runs synchronously in the
 *  same Node process — no subprocess to spawn here, since the UI server is already the
 *  always-on process on each machine. */
export async function maybeCheckForHarnessUpdate(now = Date.now()): Promise<HarnessUpdateResult | null> {
  if (!autoUpdateEnabled()) return null;
  const state = readAutoUpdateState();
  if (!autoUpdateDue(state, now, autoUpdateIntervalMs())) return null;
  const result = await runHarnessUpdate();
  recordAutoUpdateResult(result, now);
  return result;
}
