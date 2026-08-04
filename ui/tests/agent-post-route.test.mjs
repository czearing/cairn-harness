import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
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

const { handleAgentPost } = await import("../src/app/api/projects/[projectId]/agents/route.ts");

test("agent creation without a model skips Copilot catalog discovery", async () => {
  const calls = [];
  const response = await handleAgentPost(request({
    name: "Builder",
    description: "Builds",
    prompt: "Build.",
  }), "project-a", {
    addAgent: (...arguments_) => {
      calls.push(arguments_);
      return "builder";
    },
    getModelCatalog: () => {
      throw new Error("catalog discovery must not run");
    },
    restartProject: () => calls.push(["restart"]),
    schedule: (callback) => callback(),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "builder" });
  assert.deepEqual(calls, [
    ["project-a", "Builder", "Builds", "Build.", undefined, []],
    ["restart"],
  ]);
});

function request(body) {
  return new Request("http://localhost/api/projects/project-a/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
