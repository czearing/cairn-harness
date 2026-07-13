"use client";

import { useSyncExternalStore } from "react";

const key = "harness-agent-colors";
const empty: Record<string, string> = {};
let cache = "";
let parsed = empty;

export function useAgentColors() {
  const colors = useSyncExternalStore(subscribe, snapshot, () => empty);
  function update(next: Record<string, string>) {
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(key));
  }
  return [colors, update] as const;
}

function subscribe(callback: () => void) {
  window.addEventListener(key, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(key, callback);
    window.removeEventListener("storage", callback);
  };
}

function snapshot() {
  const value = localStorage.getItem(key) || "";
  if (value === cache) return parsed;
  cache = value;
  try { parsed = JSON.parse(value || "{}"); } catch { parsed = empty; }
  return parsed;
}
