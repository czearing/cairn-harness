import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const componentsRoot = fileURLToPath(new URL("../src/components/", import.meta.url));
const formSystem = readFileSync(new URL("../src/components/FormField/FormField.tsx", import.meta.url), "utf8");
const stories = readFileSync(new URL("../src/components/FormField/FormField.stories.tsx", import.meta.url), "utf8");

function componentFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(target);
    return statSync(target).isFile() && target.endsWith(".tsx") ? [target] : [];
  });
}

test("standard native controls are owned by the form system", () => {
  const bypasses = componentFiles(componentsRoot)
    .filter((file) => !file.endsWith(path.join("FormField", "FormField.tsx")))
    .filter((file) => /<(?:input|textarea|select)\b/.test(readFileSync(file, "utf8")));
  assert.deepEqual(bypasses, []);
});

test("form fields own accessible labels, descriptions, and invalid state", () => {
  assert.match(formSystem, /htmlFor=\{controlId\}/);
  assert.match(formSystem, /aria-describedby/);
  assert.match(formSystem, /aria-invalid/);
  assert.match(formSystem, /<fieldset/);
  assert.match(formSystem, /<legend>/);
});

test("form states are isolated in Storybook", () => {
  for (const story of ["Gallery", "Error", "Disabled", "InlineColor", "FileUpload", "Feedback", "KeyboardFocus"]) {
    assert.match(stories, new RegExp(`export const ${story}`));
  }
});
