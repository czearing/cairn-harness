import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = path.join(process.cwd(), "src");
const typography = readFileSync(path.join(source, "components", "Typography", "Typography.tsx"), "utf8");
const globals = readFileSync(path.join(source, "app", "globals.css"), "utf8");
const agentCard = readFileSync(path.join(source, "components", "AgentCard", "AgentCard.module.css"), "utf8");
const activityRow = readFileSync(path.join(source, "components", "ActivityRow", "ActivityRow.module.css"), "utf8");
const workMap = readFileSync(path.join(source, "components", "WorkMap", "WorkMap.module.css"), "utf8");

function cssFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const item = path.join(directory, name);
    return statSync(item).isDirectory() ? cssFiles(item) : item.endsWith(".css") ? [item] : [];
  });
}

test("typography exposes semantic variants through one shared component", () => {
  for (const variant of ["display", "titleLarge", "title", "heading", "body", "bodySmall", "label", "caption", "eyebrow", "mono"]) {
    assert.match(typography, new RegExp(`\"${variant}\"`));
  }
  assert.match(typography, /TypographyProvider/);
});

test("the application type scale has no text token below twelve pixels", () => {
  assert.match(globals, /--type-caption:\s*0\.75rem/);
  for (const file of cssFiles(source)) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /font-size:\s*(?:[0-9]|1[01])px/, `${path.relative(source, file)} uses sub-12px text`);
    assert.doesNotMatch(text, /font:\s*[^;]*\b(?:[0-9]|1[01])px(?:\/|\s)/, `${path.relative(source, file)} uses sub-12px shorthand`);
  }
});

test("semantic type weights preserve hierarchy without routine heavy text", () => {
  for (const token of ["regular", "caption", "medium", "label", "heading", "display"]) {
    assert.match(globals, new RegExp(`--weight-${token}:`));
  }
  assert.match(globals, /--weight-label:\s*500/);
  assert.match(globals, /--weight-heading:\s*550/);
  assert.match(globals, /--weight-display:\s*600/);
  assert.match(agentCard, /\.identity h3[^}]*font-weight:\s*var\(--weight-medium\)/);
  assert.match(activityRow, /\.summaryTitle[^}]*font-weight:\s*var\(--weight-medium\)/);
  assert.match(workMap, /\.rootCopy strong[^}]*font-weight:\s*var\(--weight-medium\)/);
  for (const file of cssFiles(source)) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /font-weight:\s*(?:6[5-9][0-9]|[7-9][0-9]{2})|font:\s*(?:6[5-9][0-9]|[7-9][0-9]{2})/,
      `${path.relative(source, file)} uses an unbounded heavy interface weight`,
    );
  }
});
