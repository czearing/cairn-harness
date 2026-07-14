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
  for (const root of new Set(projects.map((project) => project.root))) {
    if (current.watchers.has(root)) continue;
    try {
      current.watchers.set(root, watch(root, { recursive: true }, emit));
    } catch {}
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
