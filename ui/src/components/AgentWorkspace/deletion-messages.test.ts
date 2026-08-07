import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDeletionPreview } from "./agent-workspace-types.ts";
import { agentDeletionBlockers, agentDeletionConsequence } from "./deletion-messages.ts";

function preview(overrides: Partial<AgentDeletionPreview> = {}): AgentDeletionPreview {
  return {
    revision: 3,
    targetId: "builder",
    targetKind: "source",
    affected: [{ id: "builder", kind: "source", status: "idle" }],
    blockers: [],
    canDelete: true,
    ...overrides,
  };
}

test("a deletable agent states the permanent consequence", () => {
  const message = agentDeletionConsequence(preview(), "Builder");
  assert.match(message, /Permanently deletes Builder/);
  assert.match(message, /cannot be undone/);
});

test("derived instances are named so the blast radius is visible before deleting", () => {
  const message = agentDeletionConsequence(preview({
    affected: [
      { id: "builder", kind: "source", status: "idle" },
      { id: "builder-2", kind: "local", status: "idle" },
    ],
  }), "Builder");
  assert.match(message, /1 agent instance/);
  assert.match(message, /builder-2/);
});

test("the project lead reports the exact step that unblocks deletion", () => {
  const [blocker, ...rest] = agentDeletionBlockers(preview({
    canDelete: false,
    blockers: [{ code: "leader", agentId: "builder" }],
  }), "Builder");
  assert.equal(rest.length, 0);
  assert.match(blocker.title, /is the project lead/);
  assert.match(blocker.detail, /Make project lead/);
});

test("active work is counted, and long claim identifiers are shortened", () => {
  const claimId = "f139216f7a9578545ccfbf3930d1fef447f7e550bb6a8f71c1bcf79a5ee04395";
  const [blocker] = agentDeletionBlockers(preview({
    canDelete: false,
    blockers: [{ code: "active_work", agentId: "builder", status: "claimed", claimId }],
  }), "Builder");
  assert.match(blocker.title, /1 task is still assigned/);
  assert.match(blocker.detail, /f139216f\u2026 \(claimed\)/);
  assert.ok(!blocker.detail.includes(claimId), "the full 64 character claim id must not leak into the message");
});

test("only the first four blocking tasks are listed, and the remainder is summarized", () => {
  const [blocker] = agentDeletionBlockers(preview({
    canDelete: false,
    blockers: Array.from({ length: 7 }, (_, index) => ({
      code: "active_work",
      agentId: "builder",
      status: "claimed",
      claimId: `task-${index}`,
    })),
  }), "Builder");
  assert.match(blocker.title, /7 tasks are still assigned/);
  assert.match(blocker.detail, /and 3 more/);
});

test("both blockers are reported together so nothing is discovered one at a time", () => {
  const blockers = agentDeletionBlockers(preview({
    canDelete: false,
    blockers: [
      { code: "leader", agentId: "builder" },
      { code: "active_work", agentId: "builder", status: "claimed", claimId: "task-1" },
    ],
  }), "Builder");
  assert.equal(blockers.length, 2);
});
