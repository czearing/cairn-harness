import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";

export interface ProcessIdentity {
  start: string;
  command: string;
}

export interface WorkerRecord {
  pid: number;
  config: string;
  startedAt: string;
  log: string;
  process: ProcessIdentity;
  verification?: string;
}

type IdentityReader = (pid: number) => ProcessIdentity | null;
type ProcessLivenessReader = (pid: number) => boolean;
type ProcessStartReader = (pid: number) => string | null;
const identityProbeTimeoutMs = 20_000;
const identityProbeAttempts = 2;
const windowsIdentityOperationTimeoutSec = 10;
const identityCacheMs = 30_000;

export function ownsWorkerProcess(record: unknown, readIdentity: IdentityReader = readProcessIdentity): record is WorkerRecord {
  if (!isWorkerRecord(record)) return false;
  const current = readIdentity(record.pid);
  return current?.start === record.process.start && current.command === record.process.command;
}

export function resolveWorkerProcess(
  record: unknown,
  expectedConfig: string,
  readIdentity: IdentityReader = readProcessIdentity,
): WorkerRecord | null {
  if (isWorkerRecord(record) && record.config !== expectedConfig) return null;
  if (ownsWorkerProcess(record, readIdentity)) return record;
  if (!isLegacyWorkerRecord(record) || record.config !== expectedConfig) return null;
  const process = readIdentity(record.pid);
  if (!process || !matchesWorkerCommand(process.command, expectedConfig)) return null;
  return { ...record, process };
}

export function createCachedWorkerProcessResolver(
  isAlive: ProcessLivenessReader = processIsAlive,
) {
  const verified = new Map<string, { record: WorkerRecord; checkedAt: number }>();
  return (
    record: unknown,
    expectedConfig: string,
    readIdentity: IdentityReader = readProcessIdentity,
    readStart: ProcessStartReader = readProcessStart,
  ) => {
    const cached = verified.get(expectedConfig);
    if (isWorkerRecord(record) && cached && sameWorkerRecord(record, cached.record)) {
      if (isAlive(record.pid) && Date.now() - cached.checkedAt < identityCacheMs) return record;
      verified.delete(expectedConfig);
    }
    if (isWorkerRecord(record) && record.config === expectedConfig && verifiesWorkerRecord(record)) {
      const alive = isAlive(record.pid);
      if (process.env.HARNESS_DEBUG_WORKER_CACHE === "1") console.error(`[worker-cache] signed pid=${record.pid} alive=${alive}`);
      if (alive && sameProcessStart(record.process.start, readStart(record.pid))) {
        verified.set(expectedConfig, { record, checkedAt: Date.now() });
        return record;
      }
    }
    if (process.env.HARNESS_DEBUG_WORKER_CACHE === "1") console.error("[worker-cache] full identity");
    const resolved = resolveWorkerProcess(record, expectedConfig, readIdentity);
    const trusted = resolved ? signWorkerRecord(resolved) : resolved;
    if (trusted) verified.set(expectedConfig, { record: trusted, checkedAt: Date.now() });
    else verified.delete(expectedConfig);
    return trusted;
  };
}

export function withOwnedWorker(
  record: unknown,
  action: (owned: WorkerRecord) => void,
  readIdentity: IdentityReader = readProcessIdentity,
) {
  if (!ownsWorkerProcess(record, readIdentity)) return false;
  action(record);
  return true;
}

export function readProcessIdentity(pid: number): ProcessIdentity | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "linux") return readLinuxIdentity(pid);
    if (process.platform === "win32") return readWindowsIdentity(pid);
    return readPsIdentity(pid);
  } catch {
    return null;
  }
}

function isWorkerRecord(value: unknown): value is WorkerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<WorkerRecord>;
  return Number.isSafeInteger(record.pid) && Number(record.pid) > 0
    && nonempty(record.config) && nonempty(record.startedAt) && nonempty(record.log)
    && Boolean(record.process) && nonempty(record.process?.start) && nonempty(record.process?.command);
}

function isLegacyWorkerRecord(value: unknown): value is Omit<WorkerRecord, "process"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<WorkerRecord>;
  return Number.isSafeInteger(record.pid) && Number(record.pid) > 0
    && nonempty(record.config) && nonempty(record.startedAt) && nonempty(record.log)
    && !record.process;
}

function matchesWorkerCommand(command: string, config: string) {
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("cairn-harness")
    && normalized.includes(config.replaceAll("\\", "/").toLowerCase())
    && /(?:^|[\s",])watch(?:$|[\s"])/.test(normalized);
}

function sameWorkerRecord(left: WorkerRecord, right: WorkerRecord) {
  return left.pid === right.pid
    && left.config === right.config
    && left.startedAt === right.startedAt
    && left.log === right.log
    && left.process.start === right.process.start
    && left.process.command === right.process.command;
}

function signWorkerRecord(record: WorkerRecord): WorkerRecord {
  return { ...record, verification: workerRecordSignature(record) };
}

function verifiesWorkerRecord(record: WorkerRecord) {
  if (!record.verification || !/^[a-f0-9]{64}$/.test(record.verification)) return false;
  const actual = Buffer.from(record.verification, "hex");
  const expected = Buffer.from(workerRecordSignature(record), "hex");
  return timingSafeEqual(actual, expected);
}

function workerRecordSignature(record: WorkerRecord) {
  return createHash("sha256").update(JSON.stringify([
    record.pid,
    record.config,
    record.startedAt,
    record.log,
    record.process.start,
    record.process.command,
  ])).digest("hex");
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcessStart(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform !== "win32") return readProcessIdentity(pid)?.start || null;
  const script = `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if($p){$p.StartTime.ToUniversalTime().ToString("o")}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: identityProbeTimeoutMs,
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function sameProcessStart(expected: string, actual: string | null) {
  if (!actual) return false;
  const expectedTime = Date.parse(expected);
  const actualTime = Date.parse(actual);
  return Number.isFinite(expectedTime) && Number.isFinite(actualTime)
    ? expectedTime === actualTime
    : expected === actual;
}

function readLinuxIdentity(pid: number): ProcessIdentity | null {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  const start = fields[19];
  const command = JSON.stringify(readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean));
  return nonempty(start) && command !== "[]" ? { start, command } : null;
}

function readWindowsIdentity(pid: number): ProcessIdentity | null {
  const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -OperationTimeoutSec ${windowsIdentityOperationTimeoutSec};if($p){@{start=$p.CreationDate.ToString("o");command=$p.CommandLine}|ConvertTo-Json -Compress}`;
  for (let attempt = 0; attempt < identityProbeAttempts; attempt += 1) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: identityProbeTimeoutMs,
    });
    if (result.status !== 0 || !result.stdout.trim()) {
      if (!processIsAlive(pid)) return null;
      continue;
    }
    const value = JSON.parse(result.stdout) as { start?: unknown; command?: unknown };
    return nonempty(value.start) && nonempty(value.command) ? { start: value.start, command: value.command } : null;
  }
  return null;
}

function readPsIdentity(pid: number): ProcessIdentity | null {
  const start = psValue(pid, "lstart=");
  const command = psValue(pid, "command=");
  return nonempty(start) && nonempty(command) ? { start, command } : null;
}

function psValue(pid: number, field: string) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", field], {
    encoding: "utf8",
    timeout: identityProbeTimeoutMs,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
