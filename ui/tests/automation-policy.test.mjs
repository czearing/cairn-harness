import assert from "node:assert/strict";
import test from "node:test";
import { applyAutomationConfig } from "../src/server/automation-policy.ts";

test("workflow automation persists root capacity with existing limits", () => {
  const config = { roles: [{ name: "ideas" }] };
  applyAutomationConfig(config, {
    maxActiveTasks: 2,
    ideaAgents: [{ agentId: "ideas", taskLimit: 4, prompt: "Create useful work." }],
  });

  assert.equal("leader_task_limit" in config, false);
  assert.equal(config.max_active_tasks, 2);
  assert.deepEqual(config.idea_agents, [{
    agent: "ideas",
    task_limit: 4,
    prompt: "Create useful work.",
  }]);
});

test("blank root capacity preserves the existing unlimited default", () => {
  const config = {
    roles: [],
    leader_task_limit: 3,
    max_active_tasks: 2,
    idea_agents: [],
  };
  applyAutomationConfig(config, { ideaAgents: [] });

  assert.equal("leader_task_limit" in config, false);
  assert.equal("max_active_tasks" in config, false);
});

test("root capacity must be a positive integer", () => {
  assert.throws(
    () => applyAutomationConfig({ roles: [] }, {
      maxActiveTasks: 0,
      ideaAgents: [],
    }),
    /Maximum active tasks must be at least one/,
  );
});
