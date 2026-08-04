import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

export function createRuntimeDist(source, runtime) {
  const sourcePath = path.resolve(source);
  const runtimePath = path.resolve(runtime);
  if (sourcePath === runtimePath) return false;
  if (!existsSync(sourcePath)) {
    throw new Error(`Production build not found: ${sourcePath}`);
  }
  rmSync(runtimePath, { recursive: true, force: true });
  cpSync(sourcePath, runtimePath, { recursive: true });
  return true;
}

export function removeRuntimeDist(runtime, created) {
  if (created) rmSync(path.resolve(runtime), { recursive: true, force: true });
}
