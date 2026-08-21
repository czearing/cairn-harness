import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(packageRoot));
const appComponents = path.join(repoRoot, "ui", "src", "components");
const packageComponents = path.join(packageRoot, "src", "components");

const components = ["Button", "CardSurface", "IconButton", "Panel", "StatusIndicator", "Typography"];
const stylesheets = [
  [path.join(repoRoot, "ui", "src", "app", "globals.css"), path.join(packageRoot, "src", "tokens.css")],
];

/**
 * The package resolves siblings relatively because it has no bundler alias of its own,
 * while the application uses its `@/` alias. That single rewrite is expected, so it is
 * normalised away rather than reported on every run.
 */
function normalise(source) {
  return source.replaceAll("@/components/", "../").replace(/\r\n/gu, "\n").trimEnd();
}

const differences = [];

for (const component of components) {
  for (const file of [`${component}.tsx`, `${component}.module.css`]) {
    const app = await read(path.join(appComponents, component, file));
    const packaged = await read(path.join(packageComponents, component, file));
    if (app === null && packaged === null) continue;
    if (app === null) differences.push(`${file}: missing in ui/src/components/${component}`);
    else if (packaged === null) differences.push(`${file}: missing in packages/design`);
    else if (normalise(app) !== normalise(packaged)) differences.push(`${file}: diverged`);
  }
}

for (const [appFile, packageFile] of stylesheets) {
  const app = await read(appFile);
  const packaged = await read(packageFile);
  if (normalise(app) !== normalise(packaged)) {
    differences.push(`${path.relative(repoRoot, packageFile)}: diverged from ${path.relative(repoRoot, appFile)}`);
  }
}

if (differences.length > 0) {
  console.error("Design package has drifted from the harness application:");
  for (const difference of differences) console.error(`  ${difference}`);
  process.exitCode = 1;
} else {
  console.log(`Design package matches the harness application (${components.length} components, ${stylesheets.length} stylesheet).`);
}

async function read(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
