import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey } from "./completion-series.ts";

// The zone-less fast path must agree with the formatter it replaces, for every hour of the day and across
// a daylight-saving transition, or completions would silently move between days depending on the caller.
test("the zone-less fast path matches the formatter for the host zone", () => {
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (let hours = 0; hours < 24 * 400; hours += 7) {
    const at = new Date(Date.UTC(2025, 0, 1, hours)).toISOString();
    assert.equal(dayKey(at), dayKey(at, host), at);
  }
});
