// A browser that closes a tab, navigates, or loses the connection leaves this stream's controller
// closed while watcher callbacks are still queued. Enqueuing onto a closed controller throws
// TypeError: Invalid state, and those callbacks run on timers, where an uncaught throw is an
// uncaughtException that exits the whole server and disconnects every other tab.
export const HEARTBEAT_MS = 15_000;

export interface EventStreamOptions {
  // Receives a `send` that is safe to call at any time, and returns the teardown for its sources.
  start: (send: (payload: string) => void) => () => void;
  signal?: AbortSignal;
  heartbeatMs?: number;
  schedule?: (callback: () => void, ms: number) => { close: () => void };
}

const defaultSchedule = (callback: () => void, ms: number) => {
  const timer = setInterval(callback, ms);
  timer.unref?.();
  return { close: () => clearInterval(timer) };
};

export function createEventStream(options: EventStreamOptions) {
  const { start, signal, heartbeatMs = HEARTBEAT_MS, schedule = defaultSchedule } = options;
  const encoder = new TextEncoder();
  let close = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let stopHeartbeat = () => {};
      let stopSources = () => {};
      close = () => {
        if (!open) return;
        open = false;
        signal?.removeEventListener("abort", close);
        stopHeartbeat();
        stopSources();
      };
      const send = (payload: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // The client is already gone; stop producing rather than escalating to the runtime.
          close();
        }
      };
      // An idle stream is indistinguishable from a dead one, so keep a comment flowing to let
      // both ends notice a broken connection instead of showing stale data forever.
      const heartbeat = schedule(() => send(": keep-alive\n\n"), heartbeatMs);
      stopHeartbeat = () => heartbeat.close();
      stopSources = start(send);
      if (signal?.aborted) close();
      else signal?.addEventListener("abort", close, { once: true });
    },
    cancel() { close(); },
  });
}
