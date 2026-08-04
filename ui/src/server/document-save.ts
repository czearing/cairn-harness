import { writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalWorkspaceRoot } from "./project-registry";

const OUTSIDE_PROJECT = "Document path is outside the project";

export function writeProjectDocument(projectRoot: string, relative: string, body: string) {
  if (path.isAbsolute(relative)) throw new Error(OUTSIDE_PROJECT);

  const root = canonicalWorkspaceRoot(projectRoot);
  const destination = path.resolve(root, relative);
  if (!isWithin(root, destination)) throw new Error(OUTSIDE_PROJECT);

  const canonicalDestination = canonicalWorkspaceRoot(destination);
  if (!isWithin(root, canonicalDestination)) throw new Error(OUTSIDE_PROJECT);

  writeFileSync(destination, `${body.trimEnd()}\n`);
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}
