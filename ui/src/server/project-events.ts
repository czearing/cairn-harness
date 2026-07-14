import { watch, type FSWatcher } from "node:fs";
import type { Project } from "@/lib/types";

type Listener = () => void;
const state = globalThis as typeof globalThis & { harnessEvents?: EventState };
interface EventState { listeners: Set<Listener>; watchers: Map<string, FSWatcher>; queued: boolean; }

function eventState() {
  return state.harnessEvents ||= { listeners: new Set(), watchers: new Map(), queued: false };
}

export function subscribeToProjectEvents(projects: Project[], listener: Listener) {
  const current = eventState();
  current.listeners.add(listener);
  for (const project of projects) {
    const root = project.root;
    if (current.watchers.has(root)) continue;
    try {
      current.watchers.set(root, watch(root, { recursive: true }, (_event, file) => {
        if (relevant(String(file || ""), project.workDir)) emit();
      }));
    } catch {}
  }

  function relevant(file: string, workDir?: string) {
    const normalized = file.replaceAll("\\", "/");
    const database = normalized === ".cairn-harness/harness.db"
      || normalized === ".cairn-harness/harness.db-wal";
    return normalized === "project.json"
      || normalized.startsWith(`${workDir || "work-items"}/`)
      || normalized.startsWith("todos/")
      || database;
  }
  return () => current.listeners.delete(listener);
}

function emit() {
  const current = eventState();
  if (current.queued) return;
  current.queued = true;
  queueMicrotask(() => {
    current.queued = false;
    for (const listener of current.listeners) listener();
  });
}
