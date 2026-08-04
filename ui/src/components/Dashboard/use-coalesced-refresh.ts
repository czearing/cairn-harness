"use client";

import { useEffect, useRef, useState } from "react";

const eventRefreshDelay = 50;

export function useCoalescedRefresh(refresh: () => Promise<unknown>) {
  const refreshRef = useRef(refresh);
  const active = useRef(true);
  const state = useRef<{ timer?: number; inFlight: boolean; trailing: boolean }>({ inFlight: false, trailing: false });
  refreshRef.current = refresh;
  useEffect(() => {
    const current = state.current;
    active.current = true;
    return () => {
      active.current = false;
      if (current.timer !== undefined) window.clearTimeout(current.timer);
    };
  }, []);
  const [schedule] = useState(() => function schedule() {
    const current = state.current;
    if (current.inFlight) {
      current.trailing = true;
      return;
    }
    if (current.timer !== undefined) return;
    current.timer = window.setTimeout(() => {
      current.timer = undefined;
      current.inFlight = true;
      void refreshRef.current().catch(() => undefined).finally(() => {
        current.inFlight = false;
        if (!current.trailing || !active.current) return;
        current.trailing = false;
        schedule();
      });
    }, eventRefreshDelay);
  });
  return schedule;
}
