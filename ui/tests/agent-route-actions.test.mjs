import assert from "node:assert/strict";
import test from "node:test";
import {
  handleAgentPatch,
  INVALID_AGENT_ACTION,
} from "../src/app/api/projects/[projectId]/agents/[agentId]/agent-actions.ts";

const projectId = "example-project";
const agentId = "builder";

test("valid agent PATCH actions map only to their explicit mutations", async () => {
  const cases = [
    ["make-leader", [`leader:${projectId}:${agentId}`, `restart:${projectId}`]],
    ["pause", [`pause:${projectId}:${agentId}`]],
    ["resume", [`resume:${projectId}:${agentId}`]],
    ["clear-context", [`clear:${projectId}:${agentId}`]],
    ["grant-delegate", [`delegate:${projectId}:${agentId}:true`, `restart:${projectId}`]],
    ["revoke-delegate", [`delegate:${projectId}:${agentId}:false`, `restart:${projectId}`]],
  ];

  for (const [action, expectedCalls] of cases) {
    const calls = [];
    const response = await handleAgentPatch(request(JSON.stringify({ action })), projectId, agentId, dependencies(calls));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(calls, expectedCalls);
  }
});

test("invalid agent PATCH actions are harmless", async () => {
  const cases = [
    ["invalid JSON", "{"],
    ["missing action", "{}"],
    ["non-string action", '{"action":42}'],
    ["unknown action", '{"action":"restart"}'],
    ["misspelled clear-context", '{"action":"clear-contex"}'],
  ];

  for (const [name, body] of cases) {
    const calls = [];
    const response = await handleAgentPatch(request(body), projectId, agentId, dependencies(calls));
    assert.equal(response.status, 400, name);
    assert.deepEqual(await response.json(), { error: INVALID_AGENT_ACTION }, name);
    assert.deepEqual(calls, [], name);
  }
});

test("agent capability conflicts preserve their typed status and code", async () => {
  const response = await handleAgentPatch(
    request('{"action":"make-leader"}'),
    projectId,
    agentId,
    dependencies([], () => {
      throw Object.assign(new Error('Agent capability "promote" is not available.'), {
        status: 409,
        code: "capability_unavailable",
      });
    }),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'Agent capability "promote" is not available.',
    code: "capability_unavailable",
  });
});

function request(body) {
  return new Request("http://localhost/api/projects/example-project/agents/builder", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  });
}

function dependencies(calls, assertCapability) {
  return {
    setProjectLeader: (project, agent) => calls.push(`leader:${project}:${agent}`),
    pauseAgent: (project, agent) => calls.push(`pause:${project}:${agent}`),
    resumeAgent: (project, agent) => calls.push(`resume:${project}:${agent}`),
    clearAgentContext: (project, agent) => calls.push(`clear:${project}:${agent}`),
    setAgentDelegate: (project, agent, canDelegate) => calls.push(`delegate:${project}:${agent}:${canDelegate}`),
    scheduleRestart: (project) => calls.push(`restart:${project}`),
    assertCapability,
  };
}
