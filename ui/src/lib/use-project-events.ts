"use client";

import { useEffect } from "react";

export function useProjectEvents(onUpdate: () => void) {
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      if (event.data === "update") onUpdate();
    };
    return () => events.close();
  }, [onUpdate]);
}
