import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../src/components/AgentWorkspace/AgentWorkspace.tsx", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/components/AgentWorkspace/SourceAgentWorkspace.tsx", import.meta.url), "utf8");
const fields = readFileSync(new URL("../src/components/AgentWorkspace/WorkspaceFields.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../src/components/AgentWorkspace/AgentSettingsNavigation.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/components/AgentWorkspace/AgentWorkspace.module.css", import.meta.url), "utf8");

test("agent configuration is a main workspace instead of a drawer", () => {
  assert.match(workspace, /<main/);
  assert.match(workspace, /Back to agents/);
  assert.match(workspace, /Open conversation/);
  assert.doesNotMatch(workspace, /ActionDrawer|role="dialog"/);
});

test("source agents lead with an autosaving prompt", () => {
  assert.match(source, /AgentSettingsNavigation/);
  assert.match(source, /<h2 id="agent-prompt-title">Instructions<\/h2>/);
  assert.match(source, /MarkdownEditor/);
  assert.match(source, /layout="workspace"/);
  assert.doesNotMatch(source, /autoFocus/);
  assert.match(source, /useAgentAutosave/);
  assert.match(navigation, /label: "Model"/);
  assert.match(styles, /\.sourceWorkspace \{ min-width: 0; \}/);
  assert.doesNotMatch(styles, /\.settingsPanel \{[^}]*border:/);
  assert.doesNotMatch(source, /Secondary settings/);
});

test("agent model selection is one shared select instead of a source decision tree", () => {
  assert.match(fields, /<FormField label="Model"><Select/);
  assert.match(fields, /<option value="">Default/);
  assert.match(fields, /<optgroup label="Override">/);
  assert.doesNotMatch(fields, /RadioGroup|Model source|Use global default|Use an agent override/);
});
