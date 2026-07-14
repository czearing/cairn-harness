"use client";

import { useSyncExternalStore } from "react";

const caches = new Map<string, { raw: string; value: Record<string, string> }>();
const empty: Record<string, string> = {};

export function useStoredRecord(key: string) {
  const value = useSyncExternalStore(
    (callback) => subscribe(key, callback),
    () => snapshot(key),
    () => empty,
  );
  function update(next: Record<string, string>) {
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(key));
  }
  return [value, update] as const;
}

function subscribe(key: string, callback: () => void) {
  window.addEventListener(key, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(key, callback);
    window.removeEventListener("storage", callback);
  };
}

function snapshot(key: string) {
  const raw = localStorage.getItem(key) || "";
  const cached = caches.get(key);
  if (cached?.raw === raw) return cached.value;
  let value = empty;
  try { value = JSON.parse(raw || "{}"); } catch {}
  caches.set(key, { raw, value });
  return value;
}
