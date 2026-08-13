import assert from "node:assert/strict";
import test from "node:test";
import { connectWithRetry, type EventSourceLike } from "./reconnecting-event-source.ts";

const CONNECTING = 0;
const CLOSED = 2;

function fakeSource() {
  const source: EventSourceLike & { closed: number } = {
    readyState: CONNECTING,
    onopen: null,
    onmessage: null,
    onerror: null,
    closed: 0,
    close() { this.closed += 1; },
  };
  return source;
}

function harness() {
  const created: ReturnType<typeof fakeSource>[] = [];
  const timers: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const connected: boolean[] = [];
  const messages: string[] = [];
  const stop = connectWithRetry({
    url: "/api/events",
    onMessage: (data) => messages.push(data),
    onConnected: (value) => connected.push(value),
    create: () => {
      const source = fakeSource();
      created.push(source);
      return source;
    },
    delay: (callback, ms) => {
      const timer = { ms, run: callback, cancelled: false };
      timers.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
  });
  const fail = (index = created.length - 1) => {
    created[index].readyState = CLOSED;
    created[index].onerror?.(null);
  };
  return { created, timers, connected, messages, stop, fail };
}

test("delivers messages from the stream", () => {
  const context = harness();
  context.created[0].onmessage?.({ data: "ready" });
  assert.deepEqual(context.messages, ["ready"]);
});

test("replaces a source that closed permanently", () => {
  const context = harness();
  context.fail();
  assert.equal(context.created.length, 1);
  context.timers[0].run();
  // A CLOSED EventSource never retries on its own, so the dashboard stays dead without this.
  assert.equal(context.created.length, 2);
});

test("does not replace a source the browser will retry itself", () => {
  const context = harness();
  context.created[0].readyState = CONNECTING;
  context.created[0].onerror?.(null);
  assert.equal(context.timers.length, 0);
  assert.equal(context.created[0].closed, 0);
});

test("backs off exponentially and stops growing at the ceiling", () => {
  const context = harness();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    context.fail();
    context.timers[attempt].run();
  }
  assert.deepEqual(
    context.timers.map((timer) => timer.ms),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000],
  );
});

test("resets the backoff once a connection succeeds", () => {
  const context = harness();
  context.fail();
  context.timers[0].run();
  context.created[1].onopen?.(null);
  context.fail(1);
  assert.equal(context.timers[1].ms, 1_000);
});

test("reports transport state so the UI can show a degraded banner", () => {
  const context = harness();
  context.fail();
  context.timers[0].run();
  context.created[1].onopen?.(null);
  assert.deepEqual(context.connected, [false, true]);
});

test("stopping cancels any pending retry and closes the source", () => {
  const context = harness();
  context.fail();
  context.stop();
  assert.equal(context.timers[0].cancelled, true);
  context.timers[0].run();
  assert.equal(context.created.length, 1);
});
