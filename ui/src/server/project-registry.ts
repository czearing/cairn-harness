import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { writeProjectConfig } from "./project-config-write";

interface ProjectRegistration {
  id: string;
  name: string;
  root: string;
}

interface ProjectCreationDependencies {
  writeProjectConfig: typeof writeProjectConfig;
}
type RegistryListener = () => void;
const registry = globalThis as typeof globalThis & { harnessProjectRegistryListeners?: Set<RegistryListener> };

export function createProject(
  name: string,
  workspace: string,
  dependencies: ProjectCreationDependencies = { writeProjectConfig },
) {
  const id = slug(name);
  if (!id) throw new Error("Project name is required");
  if (!path.isAbsolute(workspace)) throw new Error("Workspace location must be an absolute path");

  const root = canonicalWorkspaceRoot(workspace);
  const directory = path.join(projectRoot(), id);
  if (existsSync(directory)) throw new Error("A project with this name already exists");
  const existing = getProjectRegistrations().find((project) => workspaceIdentity(project.root) === workspaceIdentity(root));
  if (existing) throw new Error(`workspace is already used by ${existing.name}`);

  mkdirSync(path.join(root, ".cairn-harness"), { recursive: true });
  mkdirSync(path.join(root, "work-items", "inbox"), { recursive: true });
  mkdirSync(projectRoot(), { recursive: true });
  mkdirSync(directory);
  try {
    dependencies.writeProjectConfig(path.join(directory, "project.json"), {
      name: name.trim(), root, work_dir: "work-items", roles: [],
    });
  } catch (error) {
    try { rmSync(directory, { recursive: true, force: true }); } catch {}
    throw error;
  }
  notifyProjectRegistryChanged();
  return id;
}

export function subscribeToProjectRegistry(listener: RegistryListener) {
  const listeners = registry.harnessProjectRegistryListeners ||= new Set();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyProjectRegistryChanged() {
  for (const listener of registry.harnessProjectRegistryListeners || []) listener();
}

export function getProjectConfigPaths() {
  const explicit = process.env.HARNESS_PROJECTS?.split(path.delimiter).filter(Boolean) || [];
  const examples = process.env.HARNESS_DISCOVER_EXAMPLES === "1"
    ? projectConfigs(path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "examples"))
    : [];
  return [...explicit, ...examples, ...projectConfigs(projectRoot())]
    .filter((value, index, values) => values.indexOf(value) === index);
}

export function getProjectConfigPath(id: string) {
  return getProjectConfigPaths().find((candidate) => path.basename(path.dirname(candidate)) === id);
}

export function canonicalWorkspaceRoot(workspace: string) {
  const absolute = path.resolve(workspace);
  const remainder: string[] = [];
  let existing = absolute;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    remainder.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(realpathSync.native(existing), ...remainder);
}

function getProjectRegistrations(): ProjectRegistration[] {
  return getProjectConfigPaths().map((configPath) => {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { name: string; root: string };
    return {
      id: path.basename(path.dirname(configPath)),
      name: config.name,
      root: canonicalWorkspaceRoot(path.resolve(path.dirname(configPath), config.root)),
    };
  });
}

function workspaceIdentity(workspace: string) {
  const canonical = canonicalWorkspaceRoot(workspace);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function projectRoot() {
  return process.env.HARNESS_PROJECT_ROOT || path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "projects");
}

function projectConfigs(directory: string) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name, "project.json"))
    .filter(existsSync);
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
