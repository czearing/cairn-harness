import { existsSync, statSync } from "node:fs";

export function newestExistingPath(paths: string[]) {
  return paths
    .filter(existsSync)
    .map((file) => ({ file, modified: statSync(file).mtimeMs }))
    .sort((a, b) => b.modified - a.modified)[0]?.file;
}

export function firstExistingPath(paths: string[]) {
  return paths.find(existsSync);
}
