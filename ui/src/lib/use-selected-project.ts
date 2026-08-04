"use client";

import { useSyncExternalStore } from "react";
import { SELECTED_PROJECT_COOKIE_MAX_AGE, SELECTED_PROJECT_KEY } from "./selected-project";

const event = "harness-project-change";
let sessionSelected: string | null = null;
let hasPendingSessionSelection = false;

export function useSelectedProject(fallback?: string) {
  const selected = useSyncExternalStore(subscribe, () => readSelected() || fallback, () => fallback);
  function select(id: string) {
    writeSelected(id);
    window.dispatchEvent(new Event(event));
  }
  return [selected, select] as const;
}

function readSelected() {
  try {
    const stored = localStorage.getItem(SELECTED_PROJECT_KEY);
    if (!hasPendingSessionSelection) sessionSelected = stored;
  } catch {
    return sessionSelected;
  }
  return sessionSelected;
}

function writeSelected(id: string) {
  sessionSelected = id;
  try {
    localStorage.setItem(SELECTED_PROJECT_KEY, id);
    document.cookie = `${SELECTED_PROJECT_KEY}=${encodeURIComponent(id)}; Path=/; Max-Age=${SELECTED_PROJECT_COOKIE_MAX_AGE}; SameSite=Lax`;
    hasPendingSessionSelection = false;
  } catch {
    hasPendingSessionSelection = true;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener("storage", callback);
  };
}
