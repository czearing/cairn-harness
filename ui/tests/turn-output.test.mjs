import assert from "node:assert/strict";
import test from "node:test";
import { parseTurnOutput } from "../src/server/turn-output.ts";

test("null optional turn fields remain valid", () => {
  assert.deepEqual(parseTurnOutput('{"summary":"Delegated: task","deliverable":null}'), {
    output: { summary: "Delegated: task", deliverable: undefined },
    malformed: false,
  });
});

test("invalid JSON and typed fields remain malformed", () => {
  assert.equal(parseTurnOutput("{ malformed").malformed, true);
  assert.equal(parseTurnOutput('{"summary":42}').malformed, true);
});
