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

const { migrateLegacyProjectModel, validateModelOverride } = await import("../src/server/model-config.ts");
const { ModelCatalogError, modelCatalogError, parseModelCatalogMessage } = await import("../src/server/model-catalog.ts");
const { copilotInvocation } = await import("../src/server/copilot-command.ts");
const { modelCatalogCopy } = await import("../src/lib/model-catalog-copy.ts");

test("legacy project model migrates to agent overrides once", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harness-model-migration-"));
  const file = path.join(directory, "project.json");
  const config = {
    name: "Legacy",
    root: "workspace",
    roles: [
      { name: "lead", description: "Lead", prompt: "Lead." },
      { name: "builder", description: "Build", prompt: "Build.", model: "gpt-5.5" },
    ],
    copilot: { model: "gpt-5.4-mini", startup_timeout_ms: 30_000 },
  };
  writeFileSync(file, JSON.stringify(config));

  assert.equal(migrateLegacyProjectModel(file, config), true);
  assert.equal(migrateLegacyProjectModel(file, config), false);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    ...config,
    roles: [
      { name: "lead", description: "Lead", prompt: "Lead.", model: "gpt-5.4-mini" },
      { name: "builder", description: "Build", prompt: "Build.", model: "gpt-5.5" },
    ],
    copilot: { startup_timeout_ms: 30_000 },
  });
  rmSync(directory, { recursive: true, force: true });
});

test("model catalog exposes stable IDs and validation preserves inheritance", () => {
  const catalog = parseModelCatalogMessage(JSON.stringify({
    id: 2,
    result: { models: { availableModels: [{ modelId: "gpt-5.5", name: "GPT-5.5" }] } },
  }));
  assert.deepEqual(catalog, [{ id: "gpt-5.5", name: "GPT-5.5", description: undefined }]);
  assert.equal(validateModelOverride("", catalog), undefined);
  assert.equal(validateModelOverride("gpt-5.5", catalog), "gpt-5.5");
  assert.throws(() => validateModelOverride("renamed-label", catalog), /not available/);
});

test("catalog failures preserve distinct machine states and hide raw ENOENT from user copy", () => {
  const missing = modelCatalogError(new ModelCatalogError("copilot-not-found", "The Copilot CLI could not be started", "spawn copilot ENOENT"));
  assert.deepEqual(missing, {
    status: "error",
    code: "copilot-not-found",
    message: "The Copilot CLI could not be started",
    detail: "spawn copilot ENOENT",
  });

  assert.deepEqual(modelCatalogCopy(missing), {
    title: "Models couldn’t be checked",
    body: "The dashboard couldn’t start the Copilot CLI. Install copilot or set HARNESS_COPILOT_BIN, then retry.",
  });
  assert.equal(modelCatalogError(new ModelCatalogError("timeout", "Timed out")).code, "timeout");
  assert.equal(modelCatalogError(new ModelCatalogError("empty", "No models")).code, "empty");
  assert.equal(modelCatalogError(new Error("broken")).code, "discovery-failed");
});

test("Windows npm Copilot launchers use their installed loader", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harness-copilot-command-"));
  const loader = path.join(directory, "node_modules", "@github", "copilot", "npm-loader.js");
  mkdirSync(path.dirname(loader), { recursive: true });
  writeFileSync(path.join(directory, "copilot.cmd"), "");
  writeFileSync(loader, "");

  assert.deepEqual(copilotInvocation({ PATH: directory }, "win32", "C:\\node.exe"), {
    command: "C:\\node.exe",
    args: [loader],
  });
  rmSync(directory, { recursive: true, force: true });
});
