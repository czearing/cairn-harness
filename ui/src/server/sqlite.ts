import { DatabaseSync } from "node:sqlite";

const busyTimeoutMs = 15_000;

interface OpenOptions {
  readOnly?: boolean;
}

/**
 * Opens the harness SQLite database with lock contention handled.
 * Project watchers and the UI write concurrently, so a connection without a
 * busy timeout fails immediately with SQLITE_BUSY instead of waiting its turn.
 * The window is generous because a saturated machine, such as one running a
 * full repository build, can starve a writer for several seconds.
 */
export function openDatabase(file: string, options: OpenOptions = {}): DatabaseSync {
  const db = new DatabaseSync(file, { readOnly: options.readOnly === true });
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  } catch {
    // A database that cannot accept pragmas is still usable for reads.
  }
  return db;
}
