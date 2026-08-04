import { rmSync } from "node:fs";
import path from "node:path";

interface RemovalIo {
  rmSync: typeof rmSync;
}

const defaultIo: RemovalIo = { rmSync };

export function removeProjectStateAndRegistration(
  workspace: string,
  directory: string,
  managedRoot: string,
  io: RemovalIo = defaultIo,
) {
  const registration = validatedProjectDirectory(directory, managedRoot);
  const state = validatedProjectStateDirectory(workspace);
  io.rmSync(state, { recursive: true, force: true });
  io.rmSync(registration, { recursive: true, force: true });
}

function validatedProjectDirectory(directory: string, managedRoot: string) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedRoot = path.resolve(managedRoot);
  if (path.dirname(resolvedDirectory) !== resolvedRoot) {
    throw new Error("Project is outside the managed projects directory");
  }
  return resolvedDirectory;
}

function validatedProjectStateDirectory(workspace: string) {
  const resolvedWorkspace = path.resolve(workspace);
  const state = path.resolve(resolvedWorkspace, ".cairn-harness");
  if (path.dirname(state) !== resolvedWorkspace || path.basename(state) !== ".cairn-harness") {
    throw new Error("Project state is outside the workspace");
  }
  return state;
}
