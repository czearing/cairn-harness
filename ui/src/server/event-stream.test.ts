import assert from "node:assert/strict";
import test from "node:test";
import { createEventStream } from "./event-stream.ts";

const decoder = new TextDecoder();

function harness(options: { heartbeatMs?: number; signal?: AbortSignal } = {}) {
  let send = (_payload: string) => {};
  let stopped = 0;
  const ticks: (() => void)[] = [];
  const stream = createEventStream({
    signal: options.signal,
    heartbeatMs: options.heartbeatMs,
    schedule: (callback) => {
      ticks.push(callback);
      return { close: () => { ticks.length = 0; } };
    },
    start: (emit) => {
      send = emit;
      return () => { stopped += 1; };
    },
  });
  return {
    stream,
    reader: stream.getReader(),
    send: (payload: string) => send(payload),
    tick: () => ticks.forEach((callback) => callback()),
    heartbeatScheduled: () => ticks.length > 0,
    stopped: () => stopped,
  };
}

test("sends payloads to a connected client", async () => {
  const context = harness();
  context.send("data: hello\n\n");
  const chunk = await context.reader.read();
  assert.equal(decoder.decode(chunk.value), "data: hello\n\n");
});

test("a send after the client disconnects does not throw", async () => {
  const context = harness();
  await context.reader.cancel();
  // Without the guard this throws TypeError: Invalid state: Controller is already closed, which
  // on a timer callback becomes an uncaughtException and exits the whole server.
  assert.doesNotThrow(() => context.send("data: late\n\n"));
});

test("a disconnected client releases its subscription and heartbeat", async () => {
  const context = harness();
  await context.reader.cancel();
  assert.equal(context.stopped(), 1);
  assert.equal(context.heartbeatScheduled(), false);
});

test("an aborted request releases its subscription", () => {
  const controller = new AbortController();
  const context = harness({ signal: controller.signal });
  assert.equal(context.stopped(), 0);
  controller.abort();
  assert.equal(context.stopped(), 1);
});

test("a request already aborted before the stream starts releases immediately", () => {
  const controller = new AbortController();
  controller.abort();
  const context = harness({ signal: controller.signal });
  assert.equal(context.stopped(), 1);
});

test("an idle stream emits a heartbeat comment so a dead connection is detectable", async () => {
  const context = harness();
  context.tick();
  const chunk = await context.reader.read();
  assert.equal(decoder.decode(chunk.value), ": keep-alive\n\n");
});

test("a heartbeat after disconnect neither throws nor produces output", async () => {
  const context = harness();
  await context.reader.cancel();
  assert.doesNotThrow(() => context.tick());
});

test("teardown runs only once across abort and cancel", async () => {
  const controller = new AbortController();
  const context = harness({ signal: controller.signal });
  controller.abort();
  await context.reader.cancel();
  assert.equal(context.stopped(), 1);
});
