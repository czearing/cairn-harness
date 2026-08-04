import assert from "node:assert/strict";
import test from "node:test";
import { dashboardHref, parseDashboardPath } from "../src/lib/dashboard-route.ts";

test("dashboard routes round trip every major surface", () => {
  const routes = [
    { kind: "new-project" },
    { kind: "settings" },
    { kind: "system" },
    { kind: "project", projectId: "alpha project", view: "overview" },
    { kind: "project", projectId: "alpha project", view: "activity" },
    { kind: "draft", projectId: "alpha project", draftId: "draft:1" },
    { kind: "new-agent", projectId: "alpha project" },
    { kind: "conversation", projectId: "alpha project", agentId: "lead agent" },
    { kind: "conversation", projectId: "alpha project", agentId: "lead agent", focusId: "turn:7" },
    { kind: "agent-settings", projectId: "alpha project", agentId: "lead agent" },
    { kind: "project-settings", projectId: "alpha project", section: "appearance" },
    { kind: "project-settings", projectId: "alpha project", section: "workflow" },
    { kind: "project-settings", projectId: "alpha project", section: "ideas" },
  ] as const;

  for (const route of routes) {
    const href = dashboardHref(route);
    assert.deepEqual(parseDashboardPath(href), route);
  }
});

test("unknown dashboard paths do not silently select a surface", () => {
  assert.equal(parseDashboardPath("/projects/alpha/unknown"), undefined);
  assert.equal(parseDashboardPath("/agents/lead"), undefined);
});
