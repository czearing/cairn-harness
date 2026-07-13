import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getProject, getProjectConfigPath } from "./projects";

interface Role { name: string; description: string; prompt: string; }

export function sendMessage(projectId: string, agent: string, body: string) {
  const project = requiredProject(projectId);
  const db = new DatabaseSync(path.join(/*turbopackIgnore: true*/ project.root, ".cairn-harness", "harness.db"));
  db.prepare("INSERT INTO messages(id,sender,recipient,topic,body,status,created_at) VALUES(?,?,?,?,?,'pending',?)")
    .run(randomUUID(), "dashboard", agent, "dashboard-message", body, new Date().toISOString());
  db.close();
}

export function createWorkItem(projectId: string, body: string) {
  const project = requiredProject(projectId);
  const workDir = project.workDir || addWorkDirectory(projectId);
  const directory = path.join(/*turbopackIgnore: true*/ project.root, workDir, "inbox");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}.md`), `${body.trim()}\n`);
}

function addWorkDirectory(projectId: string) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.work_dir = "work-items";
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return "work-items";
}

export function createProject(name: string, rolesText: string) {
  const roles = rolesText.split("\n").map(parseRole).filter((role): role is Role => Boolean(role));
  if (!roles.length) throw new Error("Add at least one agent");
  if (new Set(roles.map((role) => role.name)).size !== roles.length) {
    throw new Error("Agent names must be unique");
  }
  const id = slug(name);
  if (!id) throw new Error("Project name is required");
  const base = process.env.HARNESS_PROJECT_ROOT || path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "projects");
  const directory = path.join(/*turbopackIgnore: true*/ base, id);
  if (existsSync(directory)) throw new Error("A project with this name already exists");
  mkdirSync(path.join(directory, "todos"), { recursive: true });
  mkdirSync(path.join(directory, "work-items", "inbox"), { recursive: true });
  writeFileSync(path.join(directory, "project.json"), `${JSON.stringify({
    name: name.trim(), root: ".", leader: roles[0].name, work_dir: "work-items", roles,
  }, null, 2)}\n`);
  return id;
}

function requiredProject(id: string) {
  const project = getProject(id);
  if (!project) throw new Error("Project not found");
  return project;
}

function parseRole(line: string) {
  const [name, description, prompt] = line.split("|").map((value) => value.trim());
  return name && description && prompt ? { name, description, prompt } : null;
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
