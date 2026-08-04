import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = path.join(process.cwd(), "src");

test("all application buttons use the shared primitive", () => {
  const bypasses = files(source)
    .filter((file) => file.endsWith(".tsx"))
    .filter((file) => !file.endsWith(path.join("components", "Button", "Button.tsx")))
    .filter((file) => /<button\b/.test(readFileSync(file, "utf8")));
  assert.deepEqual(bypasses, []);
  const unclassified = files(source)
    .filter((file) => file.endsWith(".tsx"))
    .filter((file) => !file.endsWith(path.join("components", "Button", "Button.tsx")))
    .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/<Button\b[^>]*>/gs)]
      .filter((match) => !/\bvariant=/.test(match[0]))
      .map(() => file));
  assert.deepEqual(unclassified, []);
});

test("button foundation covers hierarchy, state, and Storybook", () => {
  const component = readFileSync(path.join(source, "components", "Button", "Button.tsx"), "utf8");
  const styles = readFileSync(path.join(source, "components", "Button", "Button.module.css"), "utf8");
  const story = readFileSync(path.join(source, "components", "Button", "Button.stories.tsx"), "utf8");
  for (const variant of ["primary", "secondary", "ghost", "danger", "menu", "surface", "tab"]) {
    assert.match(component, new RegExp(`\"${variant}\"`));
    assert.match(story, new RegExp(`variant=\"${variant}\"`));
  }
  assert.match(component, /loading/);
  assert.match(story, /Disabled/);
  assert.match(story, /size="icon"/);
  assert.match(styles, /font-size: var\(--type-body-sm\);[\s\S]*font-weight: var\(--weight-label\);[\s\S]*line-height: 1;/);
  for (const [size, height, radius] of [["compact", 32, "control"], ["default", 36, "control"], ["large", 42, "control"], ["icon", 36, "control"], ["icon-compact", 28, "sm"]]) {
    assert.match(styles, new RegExp(`data-button-size="${size}"[^}]*height: ${height}px;[^}]*min-height: ${height}px;`));
    assert.match(styles, new RegExp(`data-button-size="${size}"[^}]*border-radius: var\\(--radius-${radius}\\);`));
  }
});

test("geometry-owned controls are isolated from shared Button sizing", () => {
  const styles = readFileSync(path.join(source, "components", "Button", "Button.module.css"), "utf8");
  assert.doesNotMatch(styles, /^\.button\s*\{/m);
  for (const size of ["compact", "default", "large", "icon", "icon-compact"]) {
    assert.match(styles, new RegExp(`not\\(\\[data-button-variant="inherit"\\]\\)\\[data-button-size="${size}"\\]`));
  }
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*not\(\[data-button-variant="inherit"\]\)\[data-button-size\] \{ height: 44px; min-height: 44px; \}/);
  const owners = [
    ["ActivityRow/ActivityRow.tsx", /variant="inherit"[^>]*className=\{`\$\{styles\.row\}/s],
    ["AgentCard/AgentCardSurface.tsx", /variant="inherit"[^>]*className=\{styles\.hit\}/s],
    ["ProjectNavItem/ProjectNavItem.tsx", /variant="inherit"[^>]*data-project-selection/s],
    ["QueueRow/QueueRow.tsx", /variant="inherit"[^>]*className=\{`\$\{styles\.row\}/s],
    ["WorkMap/WorkMapRootCard.tsx", /variant="inherit"[^>]*className=\{styles\.rootButton\}/s],
    ["WorkMap/WorkMapChildRow.tsx", /variant="inherit"[^>]*className=\{styles\.childButton\}/s],
  ];
  for (const [relative, pattern] of owners) {
    assert.match(readFileSync(path.join(source, "components", relative), "utf8"), pattern);
  }
});

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name);
    return statSync(entry).isDirectory() ? files(entry) : [entry];
  });
}


