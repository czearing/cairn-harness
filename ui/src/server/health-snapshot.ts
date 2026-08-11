import { statSync } from "node:fs";
import path from "node:path";
import type { HealthState } from "@/lib/types";

interface HealthEntry { signature: string; computedAt: number; state: HealthState; }
const store = globalThis as typeof globalThis & { harnessHealthSnapshot?: HealthEntry };

/**
 * Longest a health read may be reused while its inputs keep changing. Agents write to the
 * project databases continuously, so the signature alone would never match and every poll
 * would repeat the full scan. Every open tab polls health about once a second, so this
 * bounds the blocking work to one scan per window no matter how many tabs are watching.
 */
const healthCacheMs = 1_000;

function stamp(file: string) {
  const stats = statSync(file, { bigint: true, throwIfNoEntry: false });
  return stats ? `${stats.mtimeNs}:${stats.size}` : "-";
}

/**
 * Cheap stat-only signature of every input getHealth consumes beyond the project listing.
 * Reading health opens each project's SQLite database synchronously and can probe worker
 * processes, which blocks the whole event loop, so the signature must avoid both.
 */
export function healthInputSignature(roots: { id: string; root: string }[]) {
  return roots
    .map(({ id, root }) => {
      const harness = path.join(root, ".cairn-harness");
      return `${id}=${stamp(path.join(harness, "harness.db"))},${stamp(path.join(harness, "harness.db-wal"))},${stamp(path.join(harness, "ui-worker.json"))}`;
    })
    .join("|");
}

export function cachedHealth(signature: string) {
  const entry = store.harnessHealthSnapshot;
  if (!entry) return undefined;
  if (Date.now() - entry.computedAt < healthCacheMs) return entry.state;
  return entry.signature === signature ? entry.state : undefined;
}

export function storeHealth(signature: string, state: HealthState) {
  store.harnessHealthSnapshot = { signature, computedAt: Date.now(), state };
}

export function invalidateHealthSnapshot() {
  store.harnessHealthSnapshot = undefined;
}
