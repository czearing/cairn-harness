import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { getProjectConfigPath, getProjects } from "./projects";

interface WorkerRecord { pid: number; config: string; startedAt: string; }

export function startAllProjects() {
  if (process.env.HARNESS_DISABLE_SUPERVISOR === "1") return;
  for (const project of getProjects()) ensureProjectRunning(project.id);
}

export function ensureProjectRunning(projectId: string) {
  const config = getProjectConfigPath(projectId);
  if (!config) return false;
  const project = getProjects().find((candidate) => candidate.id === projectId);
  if (!project) return false;
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
  child.unref();
  mkdirSync(path.dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ pid: child.pid, config, startedAt: new Date().toISOString() } satisfies WorkerRecord));
  return true;
}

function harnessInvocation(config: string) {
  if (process.env.HARNESS_BIN) {
    return { command: process.env.HARNESS_BIN, args: ["--config", config, "watch"] };
  }
  const root = path.resolve(process.cwd(), "..");
  for (const name of ["release", "debug"]) {
    const binary = path.join(root, "target", name, process.platform === "win32" ? "cairn-harness.exe" : "cairn-harness");
    if (existsSync(binary)) return { command: binary, args: ["--config", config, "watch"] };
  }
  return {
    command: "cargo",
    args: ["run", "--quiet", "--manifest-path", path.join(root, "Cargo.toml"), "--", "--config", config, "watch"],
  };
}

function readRecord(file: string): WorkerRecord | null {
  try { return JSON.parse(readFileSync(file, "utf8")) as WorkerRecord; }
  catch { return null; }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
