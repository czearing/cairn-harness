import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const stateDirectoryName = ".cairn-harness";

/** Creates the workspace-local Harness state directory and keeps it out of the workspace's Git repository. */
export function ensureWorkspaceStateDirectory(root: string): string {
  const directory = path.join(root, stateDirectoryName);
  mkdirSync(directory, { recursive: true });
  const ignore = path.join(directory, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  return directory;
}
