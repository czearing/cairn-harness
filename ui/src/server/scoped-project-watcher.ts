import { watch, existsSync, readdirSync, type FSWatcher } from "node:fs";
import path from "node:path";

export interface ProjectWatcher {
  close(): void;
  on?(event: "error", handler: () => void): void;
}

type Emit = (event: string, file: string | Buffer | null) => void;

/** Directories that appear and disappear are re-checked on this interval as a safety net. */
const RECONCILE_MS = 15_000;

/**
 * Watches only the paths a project event can come from.
 *
 * A single recursive watch of the project root also reports every build artefact the agents
 * produce -- in their own session workspaces and in the project's `target/` -- which is
 * overwhelmingly discarded. That wasted work is unbounded during a build and risks overflowing the
 * platform's change buffer, which silently drops the events that do matter.
 */
export function watchProjectScoped(root: string, emit: Emit, workDir?: string): ProjectWatcher {
  const watchers = new Map<string, FSWatcher>();
  const errorHandlers: (() => void)[] = [];
  let closed = false;

  const scopes = () => scopePaths(root, workDir || "work-items");

  const add = (relative: string, recursive: boolean) => {
    if (watchers.has(relative)) return;
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) return;
    try {
      const watcher = watch(absolute, { recursive }, (event, file) => {
        const name = String(file || "");
        emit(event, relative ? (name ? path.join(relative, name) : relative) : name);
        // A new session directory or agent only becomes visible through its parent.
        if (!recursive) reconcile();
      });
      watcher.on("error", () => {
        watcher.close();
        watchers.delete(relative);
        for (const handler of errorHandlers) handler();
      });
      watchers.set(relative, watcher);
    } catch {
      for (const handler of errorHandlers) handler();
    }
  };

  const reconcile = () => {
    if (closed) return;
    const wanted = scopes();
    for (const [relative, recursive] of wanted) add(relative, recursive);
    for (const [relative, watcher] of watchers) {
      if (wanted.has(relative) && existsSync(path.join(root, relative))) continue;
      watcher.close();
      watchers.delete(relative);
    }
  };

  reconcile();
  const timer = setInterval(reconcile, RECONCILE_MS);
  timer.unref?.();

  return {
    close() {
      closed = true;
      clearInterval(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
    on(_event, handler) {
      errorHandlers.push(handler);
    },
  };
}

/** Maps each watched path, relative to the project root, to whether it is watched recursively. */
function scopePaths(root: string, workDir: string) {
  const scopes = new Map<string, boolean>([
    ["", false],
    [workDir, true],
    ["todos", true],
    [path.join(".cairn-harness"), false],
    [path.join(".cairn-harness", "live-responses"), false],
  ]);
  const home = path.join(".cairn-harness", "copilot-home");
  if (!existsSync(path.join(root, home))) return scopes;
  scopes.set(home, false);
  for (const agent of directories(path.join(root, home))) {
    const sessions = path.join(home, agent, "session-state");
    if (!existsSync(path.join(root, sessions))) continue;
    scopes.set(sessions, false);
    // Each session is watched shallowly so that `events.jsonl` is seen but the workspace the
    // agent builds in underneath it is not.
    for (const session of directories(path.join(root, sessions))) {
      scopes.set(path.join(sessions, session), false);
    }
  }
  return scopes;
}

function directories(absolute: string) {
  try {
    return readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
