"use client";

import { useSyncExternalStore } from "react";
import { EMPTY_STORED_RECORD, StoredRecordSnapshotCache } from "./stored-record";

const cache = new StoredRecordSnapshotCache();

export function useStoredRecord(key: string) {
  const value = useSyncExternalStore(
    (callback) => subscribe(key, callback),
    () => snapshot(key),
    () => EMPTY_STORED_RECORD,
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
  return cache.get(key, raw);
}
