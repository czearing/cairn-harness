import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { handleAgentPut } = await import("../src/app/api/projects/[projectId]/agents/[agentId]/route.ts");

test("agent prompt and details saves use the live-config mutation path", async () => {
  const calls = [];
  const dependencies = {
    updateAgentPrompt: (project, agent, prompt) => calls.push(["prompt", project, agent, prompt]),
    updateAgentDetails: (project, agent, title, description) =>
      calls.push(["details", project, agent, title, description]),
  };

  const promptResponse = await handleAgentPut(
    request({ prompt: "Use new instructions." }),
    "project-a",
    "lead",
    dependencies,
  );
  const detailsResponse = await handleAgentPut(
    request({ title: "Principal", description: "Updated role" }),
    "project-a",
    "lead",
    dependencies,
  );

  assert.equal(promptResponse.status, 200);
  assert.equal(detailsResponse.status, 200);
  assert.deepEqual(calls, [
    ["prompt", "project-a", "lead", "Use new instructions."],
    ["details", "project-a", "lead", "Principal", "Updated role"],
  ]);
});

test("independent details and instructions saves never discover models", async () => {
  const calls = [];
  const dependencies = {
    updateAgentPrompt: (project, agent, prompt) => calls.push(["instructions", project, agent, prompt]),
    updateAgentDetails: (project, agent, title, description) => calls.push(["details", project, agent, title, description]),
    getModelCatalog: () => { throw new Error("catalog discovery must not run"); },
  };

  const detailsResponse = await handleAgentPut(
    request({ details: { title: "Principal", description: "Own delivery" } }),
    "project-a",
    "lead",
    dependencies,
  );
  const instructionsResponse = await handleAgentPut(
    request({ instructions: { prompt: "Lead independently." } }),
    "project-a",
    "lead",
    dependencies,
  );

  assert.equal(detailsResponse.status, 200);
  assert.equal(instructionsResponse.status, 200);
  assert.deepEqual(calls, [
    ["details", "project-a", "lead", "Principal", "Own delivery"],
    ["instructions", "project-a", "lead", "Lead independently."],
  ]);
});

test("clearing an override skips discovery while a new override is validated", async () => {
  const calls = [];
  let discoveries = 0;
  const dependencies = {
    updateAgentModel: (project, agent, model) => calls.push([project, agent, model]),
    getModelCatalog: async () => {
      discoveries += 1;
      return [{ id: "gpt-5.5", name: "GPT-5.5" }];
    },
  };

  assert.equal((await handleAgentPut(request({ model: {} }), "project-a", "lead", dependencies)).status, 200);
  assert.equal(discoveries, 0);
  assert.equal((await handleAgentPut(request({ model: { model: "gpt-5.5" } }), "project-a", "lead", dependencies)).status, 200);
  assert.equal(discoveries, 1);
  const unavailable = await handleAgentPut(request({ model: { model: "missing" } }), "project-a", "lead", dependencies);
  assert.equal(unavailable.status, 400);
  assert.match((await unavailable.json()).error, /not available/);
  assert.deepEqual(calls, [
    ["project-a", "lead", undefined],
    ["project-a", "lead", "gpt-5.5"],
  ]);
});

test("removed clone quantity payloads are rejected", async () => {
  const response = await handleAgentPut(
    request({ quantity: 4 }),
    "project-a",
    "dev",
    {
      updateAgentPrompt: () => {},
      updateAgentDetails: () => {},
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Agent cloning is no longer supported.",
    code: "clone_feature_removed",
  });
});

test("combined agent configuration persists an explicit inherited model", async () => {
  const calls = [];
  const response = await handleAgentPut(
    request({ title: "Principal", description: "Own delivery", prompt: "Lead.", model: undefined }),
    "project-a",
    "lead",
    {
      updateAgentPrompt: () => {},
      updateAgentDetails: () => {},
      updateAgentConfiguration: (...arguments_) => calls.push(arguments_),
      getModelCatalog: async () => [{ id: "gpt-5.4-mini", name: "GPT-5.4 mini" }],
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [[
    "project-a",
    "lead",
    { title: "Principal", description: "Own delivery", prompt: "Lead.", model: undefined },
    [{ id: "gpt-5.4-mini", name: "GPT-5.4 mini" }],
  ]]);
});

test("agent API persists reloadable prompt and description updates", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "harness-agent-put-"));
  const projectDirectory = path.join(directory, "live-project");
  const root = path.join(directory, "workspace");
  const configPath = path.join(projectDirectory, "project.json");
  const previousProjects = process.env.HARNESS_PROJECTS;
  context.after(() => {
    rmSync(directory, { recursive: true, force: true });
    if (previousProjects === undefined) delete process.env.HARNESS_PROJECTS;
    else process.env.HARNESS_PROJECTS = previousProjects;
  });
  mkdirSync(projectDirectory, { recursive: true });
  mkdirSync(root);
  writeFileSync(configPath, `${JSON.stringify({
    name: "Live",
    root,
    leader: "lead",
    roles: [
      { name: "lead", title: "Lead", description: "Old description", prompt: "Old prompt." },
      { name: "peer", description: "Old peer", prompt: "Peer." },
    ],
  }, null, 2)}\n`);
  process.env.HARNESS_PROJECTS = configPath;

  const promptResponse = await handleAgentPut(
    request({ prompt: "New prompt." }, 0),
    "live-project",
    "lead",
  );
  const detailsResponse = await handleAgentPut(
    request({ title: "Principal", description: "New description" }, 1),
    "live-project",
    "lead",
  );

  assert.equal(promptResponse.status, 200);
  assert.equal(detailsResponse.status, 200);
  const persisted = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(persisted.roles[0], {
    name: "lead",
    agent_kind: "source",
    source_agent: "lead",
    instance_ordinal: 0,
    title: "Principal",
    description: "New description",
    prompt: "New prompt.",
  });

});

test("local copy configuration mutation returns a typed managed-by-source conflict", async (context) => {
  const fixture = managedFixture(context, "managed-project", [
    { name: "dev", agent_kind: "source", source_agent: "dev", instance_ordinal: 0, description: "Build", prompt: "Build." },
    { name: "dev-2", agent_kind: "local", source_agent: "dev", instance_ordinal: 1, description: "Build", prompt: "Build." },
  ]);
  const response = await handleAgentPut(request({ prompt: "Drift." }, 0), "managed-project", "dev-2");
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Managed by source agent dev",
    code: "managed_by_source",
    sourceAgentId: "dev",
  });
  assert.equal(JSON.parse(readFileSync(fixture.configPath, "utf8")).roles[2].prompt, "Build.");
});

test("source updates cascade to managed copies without erasing legacy drift", async (context) => {
  const fixture = managedFixture(context, "cascade-project", [
    { name: "dev", agent_kind: "source", source_agent: "dev", instance_ordinal: 0, description: "Build", prompt: "Build." },
    { name: "dev-2", agent_kind: "local", source_agent: "dev", instance_ordinal: 1, description: "Build", prompt: "Build." },
    { name: "dev-3", agent_kind: "local", source_agent: "dev", instance_ordinal: 2, description: "Legacy role", prompt: "Legacy prompt." },
  ]);
  assert.equal((await handleAgentPut(request({ prompt: "Build carefully." }, 0), "cascade-project", "dev")).status, 200);
  const roles = JSON.parse(readFileSync(fixture.configPath, "utf8")).roles;
  assert.equal(roles[1].prompt, "Build carefully.");
  assert.equal(roles[2].prompt, "Build carefully.");
  assert.equal(roles[3].prompt, "Legacy prompt.");
});

test("source appearance persists while local copies inherit it", async (context) => {
  const fixture = managedFixture(context, "appearance-project", [
    { name: "dev", agent_kind: "source", source_agent: "dev", instance_ordinal: 0, description: "Build", prompt: "Build." },
    { name: "dev-2", agent_kind: "local", source_agent: "dev", instance_ordinal: 1, description: "Build", prompt: "Build.", appearance: { color: "#ffffff" } },
  ]);
  const response = await handleAgentPut(
    request({ appearance: { color: "#123456", avatar: "data:image/png;base64,abc" } }, 0),
    "appearance-project",
    "dev",
  );

  assert.equal(response.status, 200);
  const persisted = JSON.parse(readFileSync(fixture.configPath, "utf8"));
  assert.deepEqual(persisted.roles[1].appearance, {
    color: "#123456",
    avatar: "data:image/png;base64,abc",
  });
  assert.equal(persisted.roles[2].appearance, undefined);
  assert.equal(persisted.configuration_revision, 1);
});

test("agent source edits require a current configuration revision", async (context) => {
  const fixture = managedFixture(context, "revision-project", [
    { name: "dev", agent_kind: "source", source_agent: "dev", instance_ordinal: 0, description: "Build", prompt: "Build." },
  ]);
  const first = await handleAgentPut(request({ prompt: "Build carefully." }, 0), "revision-project", "dev");
  assert.equal(first.status, 200);
  assert.equal((await first.json()).revision, 1);

  const stale = await handleAgentPut(request({ prompt: "Overwrite stale." }, 0), "revision-project", "dev");
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), {
    error: "This agent changed elsewhere. Review latest.",
    code: "stale_revision",
    latestRevision: 1,
  });
  const persisted = JSON.parse(readFileSync(fixture.configPath, "utf8"));
  assert.equal(persisted.configuration_revision, 1);
  assert.equal(persisted.roles[1].prompt, "Build carefully.");
});

test("agent save reports runtime reload validation failures", async () => {
  const response = await handleAgentPut(
    request({ prompt: "Persisted but not reloadable." }),
    "project-a",
    "lead",
    {
      updateAgentPrompt: () => {
        throw new Error("Saved agent config could not be reloaded: roles are invalid");
      },
      updateAgentDetails: () => {},
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Saved agent config could not be reloaded: roles are invalid",
  });
});

function request(body, revision) {
  return new Request("http://localhost/api/projects/project-a/agents/lead", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(revision === undefined ? {} : { "if-match": `"${revision}"` }),
    },
    body: JSON.stringify(body),
  });
}

function managedFixture(context, projectId, roles) {
  const directory = mkdtempSync(path.join(tmpdir(), "harness-agent-managed-"));
  const projectDirectory = path.join(directory, projectId);
  const root = path.join(directory, "workspace");
  const configPath = path.join(projectDirectory, "project.json");
  const previousProjects = process.env.HARNESS_PROJECTS;
  context.after(() => {
    rmSync(directory, { recursive: true, force: true });
    if (previousProjects === undefined) delete process.env.HARNESS_PROJECTS;
    else process.env.HARNESS_PROJECTS = previousProjects;
  });
  mkdirSync(projectDirectory, { recursive: true });
  mkdirSync(root);
  writeFileSync(configPath, `${JSON.stringify({
    name: "Managed",
    root,
    leader: "lead",
    roles: [{ name: "lead", description: "Lead", prompt: "Lead." }, ...roles],
  }, null, 2)}\n`);
  process.env.HARNESS_PROJECTS = configPath;
  return { configPath };
}
