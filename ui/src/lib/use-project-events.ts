"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

interface ProjectEvent { projectId: string; conversations: string[]; }

export function useProjectEvents(onUpdate: (event: ProjectEvent) => void) {
  const [degraded, setDegraded] = useState(false);
  const watcherDegraded = useRef(false);
  const transportDegraded = useRef(false);
  const update = useEffectEvent(onUpdate);
  useEffect(() => {
    const events = new EventSource("/api/events");
    const syncStatus = () => setDegraded(watcherDegraded.current || transportDegraded.current);
    events.onmessage = (event) => {
      if (event.data === "ready") {
        watcherDegraded.current = false;
        transportDegraded.current = false;
        syncStatus();
        return;
      }
      if (event.data === "degraded") {
        watcherDegraded.current = true;
        syncStatus();
        return;
      }
      try {
        transportDegraded.current = false;
        syncStatus();
        update(JSON.parse(event.data) as ProjectEvent);
      } catch {}
    };
    events.onerror = () => {
      transportDegraded.current = true;
      syncStatus();
    };
    return () => events.close();
  }, []);
  return degraded;
}
