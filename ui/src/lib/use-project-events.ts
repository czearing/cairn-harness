"use client";

import { useEffect, useEffectEvent } from "react";

export function useProjectEvents(onUpdate: () => void) {
  const update = useEffectEvent(onUpdate);
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      if (event.data === "update") update();
    };
    return () => events.close();
  }, []);
}
