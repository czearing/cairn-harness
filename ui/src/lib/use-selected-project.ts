"use client";

import { useSyncExternalStore } from "react";

const key = "harness-selected-project";
const event = "harness-project-change";

export function useSelectedProject(fallback?: string) {
  const selected = useSyncExternalStore(subscribe, () => localStorage.getItem(key) || fallback, () => fallback);
  function select(id: string) {
    localStorage.setItem(key, id);
    window.dispatchEvent(new Event(event));
  }
  return [selected, select] as const;
}

function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener("storage", callback);
  };
}
