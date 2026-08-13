"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { connectWithRetry } from "./reconnecting-event-source";

interface ProjectEvent { projectId: string; conversations: string[]; }

export function useProjectEvents(onUpdate: (event: ProjectEvent) => void) {
  const [degraded, setDegraded] = useState(false);
  const watcherDegraded = useRef(false);
  const transportDegraded = useRef(false);
  const update = useEffectEvent(onUpdate);
  useEffect(() => {
    const syncStatus = () => setDegraded(watcherDegraded.current || transportDegraded.current);
    return connectWithRetry({
      url: "/api/events",
      onConnected: (connected) => {
        transportDegraded.current = !connected;
        syncStatus();
      },
      onMessage: (data) => {
        if (data === "ready") {
          watcherDegraded.current = false;
          transportDegraded.current = false;
          syncStatus();
          return;
        }
        if (data === "degraded") {
          watcherDegraded.current = true;
          syncStatus();
          return;
        }
        try {
          transportDegraded.current = false;
          syncStatus();
          update(JSON.parse(data) as ProjectEvent);
        } catch {}
      },
    });
  }, []);
  return degraded;
}
