import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { firstExistingPath } from "./binary-selection";
import { readFileTail } from "./file-tail";
import { getProjectConfigPath, getProjectRuntime, getProjects } from "./projects";
import { notifyProjectRegistryChanged } from "./project-registry";
import { removeProjectStateAndRegistration } from "./project-removal";
import { supervisorEnabled, supervisorRestartDelayMs } from "./supervisor-policy";
import { createCachedWorkerProcessResolver, ownsWorkerProcess, readProcessIdentity, withOwnedWorker, type ProcessIdentity, type WorkerRecord } from "./worker-process-identity";
import { globalSettingsPath } from "./global-settings";
import { setProjectState, setProjectStateInDatabase } from "./project-state";
import { ensureWorkspaceStateDirectory } from "./workspace-state";
import { performProjectPause, performProjectRestart } from "./supervisor-transitions";

export { setProjectStateInDatabase, performProjectPause, performProjectRestart };

const resolveWorkerProcess = createCachedWorkerProcessResolver();

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
  const project = getProjectRuntime(projectId);
  if (!project) return false;
  if (!project.agents.length) return false;
  const recordPath = path.join(project.root, ".cairn-harness", "ui-worker.json");
  const record = readRecord(recordPath);
  const owned = resolveWorkerProcess(record, config);
  if (owned) {
    if (owned !== record) writeFileSync(recordPath, JSON.stringify(owned));
    return true;
  }
  rmSync(recordPath, { force: true });
  const invocation = harnessInvocation(config);
  ensureWorkspaceStateDirectory(project.root);
  const logPath = path.join(project.root, ".cairn-harness", "worker.log");
  rotateLog(logPath);
  const log = openSync(logPath, "a");
  let identity: ProcessIdentity | null = null;
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(invocation.command, invocation.args, {
      cwd: path.dirname(config), detached: true, windowsHide: true, stdio: ["ignore", log, log],
      env: { ...process.env, HARNESS_GLOBAL_SETTINGS: globalSettingsPath() },
    });
    child.once("error", (error) => {
      if (child.pid !== undefined && identity && sameWorker(readRecord(recordPath), child.pid, identity)) {
        rmSync(recordPath, { force: true });
      }
      console.error(`Project worker failed for ${projectId}`, error);
    });
  } finally { closeSync(log); }
  if (child.pid === undefined) throw new Error(`Could not start worker for ${projectId}`);
  identity = readProcessIdentity(child.pid);
  if (!identity) {
    terminateProcessTree(child);
    throw new Error(`Could not verify worker process identity for ${projectId}`);
  }
  const workerRecord = {
    pid: child.pid,
    config,
    startedAt: new Date().toISOString(),
    log: logPath,
    process: identity,
  } satisfies WorkerRecord;
  const verifiedRecord = resolveWorkerProcess(workerRecord, config, () => identity);
  writeFileSync(recordPath, JSON.stringify(verifiedRecord || workerRecord));
  const pid = child.pid;
  child.once("exit", () => {
    if (sameWorker(readRecord(recordPath), pid, identity)) rmSync(recordPath, { force: true });
    const restart = setTimeout(() => {
      try { ensureProjectRunning(projectId); }
      catch (error) { console.error(`Could not restart project worker for ${projectId}`, error); }
    }, supervisorRestartDelayMs());
    restart.unref();
  });
  child.unref();
  return true;
}

export function pauseProject(projectId: string) {
  const config = requiredConfig(projectId);
  const marker = pausePath(config);
  performProjectPause({
    markerExists: () => existsSync(marker), writeMarker: () => writeFileSync(marker, ""), stop: () => stopProject(config),
    setPaused: () => setProjectState(config, "paused", true), removeMarker: () => rmSync(marker, { force: true }),
  });
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
  const project = getProjectRuntime(projectId);
  if (!project) throw new Error("Project not found");
  const directory = path.dirname(config);
  const root = path.resolve(process.env.HARNESS_PROJECT_ROOT || path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "projects"));
  stopProject(config);
  removeProjectStateAndRegistration(project.root, directory, root);
  notifyProjectRegistryChanged();
}

export function restartProject(projectId: string) {
  const config = requiredConfig(projectId);
  performProjectRestart({
    stop: () => stopProject(config),
    paused: () => isProjectPaused(config),
    reconcile: (paused) => setProjectState(config, paused ? "paused" : "idle", true),
    start: () => { ensureProjectRunning(projectId); },
  });
}

function harnessInvocation(config: string) {
  const args = ["--config", config, "watch"];
  if (process.env.HARNESS_BIN) {
    return { command: process.env.HARNESS_BIN, args };
  }

  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
  const executable = process.platform === "win32" ? "cairn-harness.exe" : "cairn-harness";
  const binary = firstExistingPath(["release", "debug"].map((name) => path.join(root, "target", name, executable)));
  if (binary) return { command: binary, args };
  return {
    command: "cargo",
    args: ["run", "--quiet", "--manifest-path", path.join(root, "Cargo.toml"), "--", ...args],
  };
}

function terminateProcessTree(child: ReturnType<typeof spawn>) {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try { process.kill(-pid, "SIGTERM"); } catch { child.kill(); }
}

function rotateLog(logPath: string) {  try {
    if (!existsSync(logPath) || statSync(logPath).size <= 2_000_000) return;
    const retained = readFileTail(logPath, 1_000_000);
    if (retained.length) writeFileSync(logPath, retained);
  } catch {}
}

function stopProject(config: string) {
  const recordPath = recordPathFor(config);
  const record = readRecord(recordPath);
  withOwnedWorker(record, (owned) => {
    if (process.platform === "win32") {
      const result = spawnSync("taskkill.exe", ["/PID", String(owned.pid), "/T", "/F"], { windowsHide: true });
      if (result.status !== 0 && ownsWorkerProcess(owned)) throw new Error("Could not stop project worker");
    } else {
      process.kill(-owned.pid, "SIGTERM");
    }
  });
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

function readRecord(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")) as unknown; }
  catch { return null; }
}

function sameWorker(record: unknown, pid: number, identity: ProcessIdentity) {
  return ownsWorkerProcess(record, () => identity) && record.pid === pid;
}
