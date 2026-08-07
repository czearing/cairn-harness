import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Project } from "@/lib/types";

interface CacheEntry { fingerprint: string; root: string; project: Project; }
const store = globalThis as typeof globalThis & { harnessProjectSnapshots?: Map<string, CacheEntry> };

function snapshots() {
  return store.harnessProjectSnapshots ||= new Map<string, CacheEntry>();
}

function stamp(file: string) {
  const stats = statSync(file, { bigint: true, throwIfNoEntry: false });
  return stats ? `${stats.mtimeNs}:${stats.size}` : "-";
}

/**
 * Cheap stat-only signature of every input readProject consumes. Reading a project
 * opens its SQLite database synchronously, which blocks the whole event loop, so the
 * signature must be derived without opening it.
 */
export function projectInputFingerprint(configPath: string, root: string) {
  const harness = path.join(root, ".cairn-harness");
  const drafts = path.join(harness, "drafts");
  let draftStamps = "-";
  if (existsSync(drafts)) {
    try {
      draftStamps = readdirSync(drafts)
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => `${name}=${stamp(path.join(drafts, name))}`)
        .join(",");
    } catch {
      draftStamps = `unreadable:${Date.now()}`;
    }
  }
  return [
    stamp(configPath),
    existsSync(path.join(path.dirname(configPath), ".cairn-paused")) ? "paused" : "active",
    stamp(path.join(harness, "harness.db")),
    stamp(path.join(harness, "harness.db-wal")),
    draftStamps,
  ].join("|");
}

export function cachedProject(configPath: string) {
  const entry = snapshots().get(configPath);
  if (!entry) return undefined;
  return projectInputFingerprint(configPath, entry.root) === entry.fingerprint ? entry.project : undefined;
}

export function storeProject(configPath: string, root: string, fingerprint: string, project: Project) {
  snapshots().set(configPath, { fingerprint, root, project });
}

export function forgetProjects(configPaths: Iterable<string>) {
  const kept = new Set(configPaths);
  for (const key of [...snapshots().keys()]) if (!kept.has(key)) snapshots().delete(key);
}

export function invalidateProjectSnapshots() {
  snapshots().clear();
}
