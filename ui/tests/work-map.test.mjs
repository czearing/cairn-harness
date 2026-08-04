import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleWorkMap, planHealth, relativeTaskTime, summarizeAgentAssignments, workMapChildIsHistorical, workMapOrphanIsHistorical, workMapRootIsHistorical } from "../src/lib/work-map.ts";

function item(id, status, extra = {}) {
  return {
    id,
    title: id,
    meta: id,
    status,
    content: id,
    updatedAt: "2026-07-15T18:00:00.000Z",
    ...extra,
  };
}

test("WorkMap accepts only persisted work and excludes project drafts", () => {
  const workMapSource = readFileSync(new URL("../src/components/WorkMap/WorkMap.tsx", import.meta.url), "utf8");
  const projectViewSource = readFileSync(new URL("../src/components/ProjectView/ProjectView.tsx", import.meta.url), "utf8");
  const activeWorkSource = readFileSync(new URL("../src/components/ActiveWork/ActiveWork.tsx", import.meta.url), "utf8");
  const cardSurfaceSource = readFileSync(new URL("../src/components/CardSurface/CardSurface.tsx", import.meta.url), "utf8");
  const accordionSource = readFileSync(new URL("../src/components/Accordion/Accordion.tsx", import.meta.url), "utf8");
  const accordionStyles = readFileSync(new URL("../src/components/Accordion/Accordion.module.css", import.meta.url), "utf8");
  const agentCardSource = readFileSync(new URL("../src/components/AgentCard/AgentCardSurface.tsx", import.meta.url), "utf8");
  const rootCardSource = readFileSync(new URL("../src/components/WorkMap/WorkMapRootCard.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(workMapSource, /drafts:\s*QueueItem\[\]/);
  assert.doesNotMatch(workMapSource, /assembleWorkMap\([^)]*drafts/);
  assert.doesNotMatch(projectViewSource, /drafts=\{project\.drafts/);
  assert.doesNotMatch(projectViewSource, /<Panel title="Active work">/);
  assert.match(projectViewSource, /<ActiveWork/);
  assert.match(activeWorkSource, /<h2 id="active-work-heading">Active work<\/h2>/);
  assert.match(agentCardSource, /<CardSurface/);
  assert.match(rootCardSource, /<CardSurface/);
  assert.match(cardSurfaceSource, /data-card-interactive/);
  assert.match(workMapSource, /<Accordion/);
  assert.match(accordionSource, /<details/);
  assert.match(accordionSource, /<summary/);
  assert.doesNotMatch(workMapSource, /WorkMapHistory/);
  assert.doesNotMatch(accordionStyles, /\.accordion\s*\{[^}]*(border|background)/s);
  assert.doesNotMatch(activeWorkSource, /Execution|Activity/);
  assert.doesNotMatch(rootCardSource, /Needs decomposition|Delegation not started|Initiative/);
  assert.match(workMapSource, />No active work</);
  assert.match(workMapSource, /Start the next initiative from a task draft\./);
  assert.match(workMapSource, />Open task drafts</);
});

test("work map groups children, preserves orphans, and rolls up non-cancelled progress", () => {
  const root = item("root", "claimed");
  const map = assembleWorkMap([root], [
    item("delegated-parent", "completed", { parentId: "root", executorId: "builder" }),
    item("done", "completed", { parentId: "delegated-parent", executorId: "builder" }),
    item("active", "claimed", { parentId: "root", executorId: "reviewer" }),
    item("blocked", "blocked", { parentId: "root" }),
    item("cancelled", "cancelled", { parentId: "root", executorId: "builder" }),
    item("orphan", "waiting", { parentId: "missing", executorId: "builder" }),
  ]);

  assert.deepEqual(map.roots[0].children.map((child) => child.id), ["active", "blocked", "delegated-parent", "done", "cancelled"]);
  assert.deepEqual(map.roots[0].progress, { completed: 1, total: 3, active: 1, blockedOrFailed: 1 });
  assert.deepEqual(map.roots[0].health, ["1 child is unassigned."]);
  assert.deepEqual(map.orphans.map(({ item: child, reason }) => [child.id, reason]), [["orphan", "missing-parent"]]);
});

test("work map identifies delegation cycles separately from missing parents", () => {
  const map = assembleWorkMap([], [
    item("cycle-a", "waiting", { parentId: "cycle-b" }),
    item("cycle-b", "waiting", { parentId: "cycle-a" }),
    item("missing", "waiting", { parentId: "gone" }),
  ]);

  assert.deepEqual(map.orphans.map(({ item: child, reason }) => [child.id, reason]), [
    ["cycle-a", "cycle"],
    ["cycle-b", "cycle"],
    ["missing", "missing-parent"],
  ]);
});

test("plan health reports supported deterministic inconsistencies", () => {
  assert.deepEqual(planHealth(item("empty", "pending"), []), []);
  assert.deepEqual(planHealth(item("complete", "completed"), [
    item("running", "claimed", { parentId: "complete", executorId: "builder" }),
    item("failed", "failed", { parentId: "complete", executorId: "reviewer" }),
  ]), [
    "Completed root has 2 incomplete children, including 1 failed.",
  ]);
  assert.deepEqual(planHealth(item("running", "claimed"), [
    item("queued", "pending", { parentId: "running", executorId: "builder" }),
    item("waiting", "waiting", { parentId: "running", executorId: "reviewer" }),
  ]), [
    "Root is running while every delegated task is queued or waiting.",
  ]);
  assert.equal(workMapRootIsHistorical({
    root: item("clean-complete", "completed"),
    children: [],
    progress: { completed: 0, total: 0, active: 0, blockedOrFailed: 0 },
    health: [],
  }), true);
  assert.equal(workMapRootIsHistorical({
    root: item("inconsistent-complete", "completed"),
    children: [],
    progress: { completed: 0, total: 0, active: 0, blockedOrFailed: 0 },
    health: ["Completed root has an incomplete child."],
  }), false);
  assert.equal(workMapChildIsHistorical(item("done", "completed")), true);
  assert.equal(workMapChildIsHistorical(item("cancelled", "cancelled")), true);
  assert.equal(workMapChildIsHistorical(item("failed", "failed")), false);
  assert.equal(workMapOrphanIsHistorical(item("failed", "failed")), true);
  assert.equal(workMapOrphanIsHistorical(item("blocked", "blocked")), false);
});

test("agent assignment summary keeps every active assignment and chooses deterministically", () => {
  const summary = summarizeAgentAssignments([
    item("queued", "pending", { updatedAt: "2026-07-15T18:02:00.000Z" }),
    item("running-old", "claimed", { updatedAt: "2026-07-15T18:00:00.000Z" }),
    item("running-new", "claimed", { updatedAt: "2026-07-15T18:01:00.000Z" }),
    item("done", "completed"),
  ]);
  assert.equal(summary.activeCount, 3);
  assert.equal(summary.current.id, "running-new");
  const blocked = summarizeAgentAssignments([item("blocked", "blocked"), item("done", "completed")]);
  assert.equal(blocked.activeCount, 0);
  assert.equal(blocked.current.id, "blocked");
  assert.equal(relativeTaskTime("2026-07-15T17:30:00.000Z", Date.parse("2026-07-15T18:00:00.000Z")), "Updated 30m ago");
});
