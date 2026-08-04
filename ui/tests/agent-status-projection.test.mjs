import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { projectAgentStatus } = await import("../src/server/agent-status-projection.ts");

test("agent status projection distinguishes recoverable startup failures", () => {
  assert.equal(projectAgentStatus("failed", { claimed: 0, pending: 1, waiting: 0 }), "idle");
  assert.equal(projectAgentStatus("failed", { claimed: 1, pending: 0, waiting: 0 }), "working");
  assert.equal(projectAgentStatus("failed", { claimed: 0, pending: 0, waiting: 1 }), "idle");
  assert.equal(projectAgentStatus("failed", { claimed: 0, pending: 0, waiting: 0 }), "failed");
  assert.equal(projectAgentStatus("working", { claimed: 0, pending: 0, waiting: 0 }), "working");
  assert.equal(projectAgentStatus("paused", { claimed: 1, pending: 0, waiting: 0 }), "paused");
});
