import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCapability } from "./agent-capability.ts";

test("the project leader is described as able to delegate and message the team", () => {
  const capability = agentCapability({ isLeader: true, isIdeaAgent: false });

  assert.equal(capability.label, "Delegates work");
  assert.match(capability.detail, /delegate/i);
  assert.match(capability.detail, /message/i);
});

test("a non-leader idea agent is described as able to file work but not contact anyone", () => {
  const capability = agentCapability({ isLeader: false, isIdeaAgent: true });

  assert.equal(capability.label, "Files new work");
  assert.match(capability.detail, /never contacts other agents/i);
});

test("a leader that is also an idea agent keeps the leader capability", () => {
  const capability = agentCapability({ isLeader: true, isIdeaAgent: true });

  assert.equal(capability.label, "Delegates work");
});

test("a plain worker is described as status-only with no delegation or messaging", () => {
  const capability = agentCapability({ isLeader: false, isIdeaAgent: false });

  assert.equal(capability.label, "Status only");
  assert.match(capability.detail, /cannot delegate or message other agents/i);
});
