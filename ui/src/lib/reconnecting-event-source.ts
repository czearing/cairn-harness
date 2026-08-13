// EventSource only retries a connection that was established and then dropped. If the stream can
// never be opened -- an HTTP error status while the server restarts or rebuilds -- it moves to
// CLOSED and stays there, so the dashboard goes silently stale until someone reloads by hand.
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export interface EventSourceLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close: () => void;
}

export interface ReconnectingOptions {
  url: string;
  onMessage: (data: string) => void;
  onConnected?: (connected: boolean) => void;
  create?: (url: string) => EventSourceLike;
  delay?: (callback: () => void, ms: number) => { cancel: () => void };
  baseMs?: number;
  maxMs?: number;
}

const CLOSED = 2;

const defaultDelay = (callback: () => void, ms: number) => {
  const timer = setTimeout(callback, ms);
  return { cancel: () => clearTimeout(timer) };
};

export function connectWithRetry(options: ReconnectingOptions) {
  const {
    url,
    onMessage,
    onConnected = () => {},
    create = (target) => new EventSource(target) as unknown as EventSourceLike,
    delay = defaultDelay,
    baseMs = RECONNECT_BASE_MS,
    maxMs = RECONNECT_MAX_MS,
  } = options;
  let source: EventSourceLike | undefined;
  let pending: { cancel: () => void } | undefined;
  let attempt = 0;
  let stopped = false;

  const open = () => {
    if (stopped) return;
    const current = create(url);
    source = current;
    current.onopen = () => {
      attempt = 0;
      onConnected(true);
    };
    current.onmessage = (event) => onMessage(event.data);
    current.onerror = () => {
      onConnected(false);
      // A connection that merely dropped is retried by the browser; only a CLOSED source is
      // permanently dead and has to be replaced.
      if (current.readyState !== CLOSED || stopped) return;
      current.close();
      pending = delay(open, Math.min(baseMs * 2 ** attempt++, maxMs));
    };
  };

  open();
  return () => {
    stopped = true;
    pending?.cancel();
    source?.close();
  };
}
