import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getProjectConfigPath, getProjects } from "./projects";

interface WorkerRecord { pid: number; config: string; startedAt: string; }

export function startAllProjects() {
  if (!supervisorEnabled()) return;
  if (process.env.HARNESS_DISABLE_AUTOSTART === "1") return;
  for (const project of getProjects()) {
    if (!project.paused) ensureProjectRunning(project.id);
  }
}

export function ensureProjectRunning(projectId: string) {
  if (!supervisorEnabled()) return false;
  const config = getProjectConfigPath(projectId);
  if (!config) return false;
  if (isProjectPaused(config)) return false;
  const project = getProjects().find((candidate) => candidate.id === projectId);
  if (!project) return false;
  if (!project.agents.length) return false;
  const recordPath = path.join(project.root, ".cairn-harness", "ui-worker.json");
  const record = readRecord(recordPath);
  if (record?.config === config && alive(record.pid)) return true;
  if (record) rmSync(recordPath, { force: true });
  const invocation = harnessInvocation(config);
  const child = spawn(invocation.command, invocation.args, {
    cwd: path.dirname(config),
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  if (child.pid === undefined) throw new Error(`Could not start worker for ${projectId}`);
  mkdirSync(path.dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ pid: child.pid, config, startedAt: new Date().toISOString() } satisfies WorkerRecord));
  const pid = child.pid;
  child.once("exit", () => {
    if (readRecord(recordPath)?.pid === pid) rmSync(recordPath, { force: true });
  });
  child.unref();
  return true;
}

export function pauseProject(projectId: string) {
  const config = requiredConfig(projectId);
  writeFileSync(pausePath(config), "");
  stopProject(config);
  setProjectState(config, "paused", true);
}

export function resumeProject(projectId: string) {
  const config = requiredConfig(projectId);
  rmSync(pausePath(config), { force: true });
  setProjectState(config, "idle", false);
  ensureProjectRunning(projectId);
}

export function isProjectPaused(config: string) {
  return existsSync(pausePath(config));
}

export function deleteProject(projectId: string) {
  const config = requiredConfig(projectId);
  const directory = path.dirname(config);
  const root = path.resolve(process.env.HARNESS_PROJECT_ROOT || path.join(process.cwd(), "..", "projects"));
  if (path.dirname(directory) !== root) throw new Error("Project is outside the managed projects directory");
  stopProject(config);
  rmSync(directory, { recursive: true, force: true });
}

export function restartProject(projectId: string) {
  const config = requiredConfig(projectId);
  stopProject(config);
  if (!isProjectPaused(config)) ensureProjectRunning(projectId);
}

function harnessInvocation(config: string) {
  const args = ["--config", config, "watch"];
  if (process.env.HARNESS_BIN) {
    return { command: process.env.HARNESS_BIN, args };
  }
  const root = path.resolve(process.cwd(), "..");
  for (const name of ["release", "debug"]) {
    const binary = path.join(root, "target", name, process.platform === "win32" ? "cairn-harness.exe" : "cairn-harness");
    if (existsSync(binary)) return { command: binary, args };
  }
  return {
    command: "cargo",
    args: ["run", "--quiet", "--manifest-path", path.join(root, "Cargo.toml"), "--", ...args],
  };
}

function stopProject(config: string) {
  const recordPath = recordPathFor(config);
  const record = readRecord(recordPath);
  if (record && alive(record.pid)) {
    if (process.platform === "win32") {
      const result = spawnSync("taskkill.exe", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true });
      if (result.status !== 0 && alive(record.pid)) throw new Error("Could not stop project worker");
    } else {
      process.kill(-record.pid, "SIGTERM");
    }
  }
  rmSync(recordPath, { force: true });
}

function requiredConfig(projectId: string) {
  const config = getProjectConfigPath(projectId);
  if (!config) throw new Error("Project config not found");
  return config;
}

function pausePath(config: string) {
  return path.join(path.dirname(config), ".cairn-paused");
}

function recordPathFor(config: string) {
  const project = getProjects().find((candidate) => candidate.id === path.basename(path.dirname(config)));
  if (!project) throw new Error("Project not found");
  return path.join(project.root, ".cairn-harness", "ui-worker.json");
}

function setProjectState(configPath: string, status: "paused" | "idle", requeue: boolean) {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { root: string };
  const root = path.resolve(path.dirname(configPath), config.root);
  const database = path.join(root, ".cairn-harness", "harness.db");
  if (!existsSync(database)) return;
  const db = new DatabaseSync(database);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (requeue) db.exec("UPDATE messages SET status='pending',claimed_at=NULL WHERE status='claimed'");
    db.prepare("UPDATE agents SET status=?,current_topic=NULL,updated_at=?")
      .run(status, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function readRecord(file: string): WorkerRecord | null {
  try { return JSON.parse(readFileSync(file, "utf8")) as WorkerRecord; }
  catch { return null; }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function supervisorEnabled() {
  return process.env.HARNESS_ENABLE_SUPERVISOR === "1"
    && process.env.HARNESS_DISABLE_SUPERVISOR !== "1";
}
