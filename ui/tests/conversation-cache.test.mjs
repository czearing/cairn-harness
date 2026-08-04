import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationPrefetchCache,
  InFlightRequests,
  isCanonicalConversationFirstPage,
  isConversationFirstPage,
} from "../src/lib/conversation-prefetch-cache.ts";

const conversationUrl = (index) => `/api/projects/project/messages?agent=agent-${index}`;

test("conversation prefetch cache excludes paginated and focused URLs", () => {
  const cache = new ConversationPrefetchCache();
  const page = { items: [], hasMore: false };

  cache.set(`${conversationUrl(1)}&before=cursor`, page);
  cache.set(`${conversationUrl(1)}&focus=turn%3A1`, page);

  assert.equal(cache.size, 0);
  assert.equal(isCanonicalConversationFirstPage(conversationUrl(1)), true);
  assert.equal(isCanonicalConversationFirstPage(`${conversationUrl(1)}&before=cursor`), false);
  assert.equal(isCanonicalConversationFirstPage(`${conversationUrl(1)}&focus=turn%3A1`), false);
  assert.equal(isConversationFirstPage(conversationUrl(1)), true);
  assert.equal(isConversationFirstPage(`${conversationUrl(1)}&focus=turn%3A1`), true);
  assert.equal(isConversationFirstPage(`${conversationUrl(1)}&before=cursor`), false);
});

test("conversation prefetch cache retains at most 32 first pages", () => {
  const cache = new ConversationPrefetchCache();

  for (let index = 0; index < 33; index += 1) {
    cache.set(conversationUrl(index), { index });
  }

  assert.equal(cache.size, 32);
  assert.equal(cache.get(conversationUrl(0)), undefined);
  assert.deepEqual(cache.get(conversationUrl(32)), { index: 32 });
});

test("reading and refreshing entries update eviction recency", () => {
  const cache = new ConversationPrefetchCache();
  for (let index = 0; index < 32; index += 1) {
    cache.set(conversationUrl(index), { index });
  }

  assert.deepEqual(cache.get(conversationUrl(0)), { index: 0 });
  cache.set(conversationUrl(1), { index: 101 });
  cache.set(conversationUrl(32), { index: 32 });

  assert.equal(cache.get(conversationUrl(2)), undefined);
  assert.deepEqual(cache.get(conversationUrl(0)), { index: 0 });
  assert.deepEqual(cache.get(conversationUrl(1)), { index: 101 });
});

test("in-flight requests deduplicate and clear after success and failure", async () => {
  const requests = new InFlightRequests();
  let loads = 0;
  let resolve;
  const first = requests.run("focused-url", () => {
    loads += 1;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const duplicate = requests.run("focused-url", async () => {
    loads += 1;
    return "duplicate";
  });

  assert.equal(first, duplicate);
  assert.equal(loads, 1);
  resolve("first");
  assert.equal(await first, "first");
  assert.equal(await requests.run("focused-url", async () => {
    loads += 1;
    return "second";
  }), "second");

  await assert.rejects(requests.run("paginated-url", async () => {
    throw new Error("failed");
  }), /failed/);
  assert.equal(await requests.run("paginated-url", async () => "recovered"), "recovered");
});
