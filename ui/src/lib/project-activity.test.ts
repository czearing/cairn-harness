import assert from "node:assert/strict";
import { test } from "node:test";
import { projectActivity } from "./project-activity.ts";
import type { Agent, Project, QueueItem } from "./types.ts";

const item = (id: string, status: string): QueueItem => ({ id, title: id, meta: id, status });
const agent = (id: string, status: Agent["status"], topic?: string): Agent =>
  ({ id, title: id, role: id, status, topic, updatedAt: "2026-08-06T00:00:00.000Z" });

const project = (overrides: Partial<Project> = {}): Project => ({
  id: "project", name: "Project", root: "", agents: [], workItems: [],
  delegatedActions: [], activity: [], releases: 0, ...overrides,
});

test("a running agent is reported as working even when the leader has no manual work items", () => {
  // The live regression: every review is an imported root assigned to a non-leader agent, so the
  // server's leader-scoped activeWorkCount stays 0 while the project is genuinely busy.
  const activity = projectActivity(project({
    activeWorkCount: 0,
    agents: [agent("pr-reviewer", "working", "Reviewing PR 5549904")],
    workItems: [item("import-1", "claimed")],
  }));
  assert.equal(activity.status, "working");
  assert.equal(activity.label, "pr-reviewer: Reviewing PR 5549904");
  assert.equal(activity.activeCount, 1);
});

test("an idle project reads as idle rather than as success", () => {
  const activity = projectActivity(project({ agents: [agent("leader", "idle")] }));
  assert.equal(activity.status, "idle");
  assert.equal(activity.label, "No active work");
  assert.equal(activity.activeCount, 0);
});

test("work admitted but not yet started is queued, not working", () => {
  const activity = projectActivity(project({
    agents: [agent("leader", "idle")],
    workItems: [item("a", "pending"), item("b", "backlog")],
  }));
  assert.equal(activity.status, "queued");
  assert.equal(activity.label, "2 items queued");
});

test("terminal work never counts as active", () => {
  const activity = projectActivity(project({
    workItems: ["completed", "done", "released", "cancelled", "failed", "superseded"].map((status) => item(status, status)),
  }));
  assert.equal(activity.activeCount, 0);
  assert.equal(activity.status, "idle");
});

test("agents needing a human outrank running work", () => {
  const activity = projectActivity(project({
    agents: [agent("a", "budget-exhausted"), agent("b", "working", "Something")],
    workItems: [item("a", "claimed")],
  }));
  assert.equal(activity.status, "failed");
  assert.equal(activity.label, "1 agent needs attention");
});

test("a paused project outranks every other signal and keeps its queue visible", () => {
  const activity = projectActivity(project({
    paused: true,
    agents: [agent("a", "working", "Something"), agent("b", "failed")],
    workItems: [item("a", "paused"), item("b", "claimed"), item("c", "completed")],
  }));
  assert.equal(activity.status, "paused");
  assert.equal(activity.label, "Project paused");
  assert.equal(activity.activeCount, 2);
});

test("multiple running agents are summarised without a topic", () => {
  const activity = projectActivity(project({
    agents: [agent("a", "working", "One"), agent("b", "working", "Two")],
  }));
  assert.equal(activity.label, "2 agents working");
});

test("the count badge and the dot cannot disagree", () => {
  const busy = project({ agents: [agent("a", "working")], workItems: [item("a", "claimed"), item("b", "done")] });
  const activity = projectActivity(busy);
  assert.equal(activity.activeCount, 1);
  assert.equal(activity.status, "working");
  const quiet = projectActivity(project({ workItems: [item("b", "done")] }));
  assert.equal(quiet.activeCount, 0);
  assert.equal(quiet.status, "idle");
});
