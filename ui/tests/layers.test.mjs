import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { layerVariables, layers } from "../src/lib/layers.ts";

test("overlay layers have one ordered contract", () => {
  assert.deepEqual(Object.keys(layers), [
    "menu",
    "popup",
    "notification",
    "drawer",
    "modal",
    "tooltip",
  ]);
  assert.ok(layers.menu < layers.popup);
  assert.ok(layers.popup < layers.notification);
  assert.ok(layers.notification < layers.drawer);
  assert.ok(layers.drawer < layers.modal);
  assert.ok(layers.modal < layers.tooltip);
  for (const [name, value] of Object.entries(layers)) {
    assert.equal(layerVariables[`--layer-${name}`], value);
  }
});

test("overlay styles consume the shared variables", () => {
  const cases = [
    ["components/ActivityRail/ActivityRail.module.css", "--layer-popup"],
    ["components/ChatPanel/ChatPanel.module.css", "--layer-popup"],
    ["components/Dashboard/Dashboard.module.css", "--layer-notification"],
    ["components/NewProjectForm/NewProjectForm.module.css", "--layer-tooltip"],
  ];
  for (const [file, variable] of cases) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`z-index: var\\(${variable}\\)`));
  }
});

test("body portals use the shared portal component", () => {
  for (const file of [
    "ActionDrawer/ActionDrawer.tsx",
    "AgentCard/AgentCardMenu.tsx",
    "Modal/Modal.tsx",
    "ProjectContextMenu/ProjectContextMenu.tsx",
    "RowActions/RowActions.tsx",
  ]) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
    assert.match(source, /<OverlayPortal layer="/);
    assert.doesNotMatch(source, /createPortal/);
  }
});
