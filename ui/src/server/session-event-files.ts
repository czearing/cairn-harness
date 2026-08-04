import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { normalizeSessionEventTimestamp, parseSessionEvent } from "./session-event-projector.ts";

export interface SessionFile {
  file: string;
  sessionId: string;
  modified: number;
}

export function sessionFiles(root: string, agent: string): SessionFile[] {
  const directory = path.join(root, ".cairn-harness", "copilot-home", agent, "session-state");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = sessionEventFile(root, agent, entry.name);
      return { file, sessionId: entry.name, modified: existsSync(file) ? statSync(file).mtimeMs : 0 };
    })
    .filter((entry) => entry.modified)
    .sort((a, b) => b.modified - a.modified);
}

export function sessionEventFile(root: string, agent: string, sessionId: string) {
  return path.join(root, ".cairn-harness", "copilot-home", agent, "session-state", sessionId, "events.jsonl");
}

export function sessionTimeRange(file: string) {
  const size = statSync(file).size;
  const sampleSize = Math.min(size, 64 * 1024);
  const descriptor = openSync(file, "r");
  try {
    const timestamps = [
      ...readTimestamps(descriptor, 0, sampleSize),
      ...(size > sampleSize ? readTimestamps(descriptor, size - sampleSize, sampleSize) : []),
    ].sort();
    return timestamps.length ? { first: timestamps[0], last: timestamps[timestamps.length - 1] } : undefined;
  } finally {
    closeSync(descriptor);
  }
}

function readTimestamps(descriptor: number, position: number, length: number) {
  const buffer = Buffer.alloc(length);
  readSync(descriptor, buffer, 0, length, position);
  return buffer.toString("utf8").split(/\r?\n/)
    .map(parseSessionEvent)
    .filter((event) => Boolean(event))
    .map((event) => normalizeSessionEventTimestamp(event?.timestamp))
    .filter((timestamp): timestamp is string => Boolean(timestamp));
}
