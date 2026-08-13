import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

const MANIFESTS = ["build-manifest.json", "app-build-manifest.json"];

export function createRuntimeDist(source, runtime, { rename = renameSync } = {}) {
  const sourcePath = path.resolve(source);
  const runtimePath = path.resolve(runtime);
  if (sourcePath === runtimePath) return null;
  if (!existsSync(sourcePath)) {
    throw new Error(`Production build not found: ${sourcePath}`);
  }
  const stagingPath = `${runtimePath}.staging`;
  rmSync(stagingPath, { recursive: true, force: true });
  cpSync(sourcePath, stagingPath, { recursive: true });
  assertCompleteDist(stagingPath);
  rmSync(runtimePath, { recursive: true, force: true });
  try {
    rename(stagingPath, runtimePath);
    return runtime;
  } catch (error) {
    // Real-time antivirus can hold handles on a freshly copied tree long enough that this rename
    // fails for as long as anyone retries. The copy is already complete and verified, so serve it
    // where it landed; refusing to start leaves the dashboard down until a human intervenes.
    if (!existsSync(stagingPath)) throw error;
    console.warn(`Serving the runtime build in place: ${error.code || error.message}`);
    // Next resolves NEXT_DIST_DIR against the project root, so keep the caller's path form.
    return `${runtime}.staging`;
  }
}

/// Rejects a torn copy taken while the source build was still being written.
function assertCompleteDist(distPath) {
  if (!existsSync(path.join(distPath, "BUILD_ID"))) {
    rmSync(distPath, { recursive: true, force: true });
    throw new Error("Production build is incomplete: BUILD_ID is missing");
  }
  for (const manifest of MANIFESTS) {
    const manifestPath = path.join(distPath, manifest);
    if (!existsSync(manifestPath)) continue;
    for (const asset of manifestAssets(manifestPath)) {
      if (existsSync(path.join(distPath, asset))) continue;
      rmSync(distPath, { recursive: true, force: true });
      throw new Error(`Production build is incomplete: ${manifest} references missing ${asset}`);
    }
  }
}

function manifestAssets(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const assets = new Set();
  collectAssets(manifest.pages ?? manifest, assets);
  collectAssets(manifest.rootMainFiles ?? [], assets);
  return assets;
}

function collectAssets(value, assets) {
  if (typeof value === "string") {
    if (value.endsWith(".js") || value.endsWith(".css")) assets.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectAssets(entry, assets);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectAssets(entry, assets);
  }
}

/// Reclaims runtime copies orphaned when a previous server was killed before its exit handler ran.
export function sweepOrphanedRuntimeDists(directory, prefix, isAlive = isProcessAlive) {
  const root = path.resolve(directory);
  if (!existsSync(root)) return [];
  const removed = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const suffix = entry.name.slice(prefix.length).replace(/\.staging$/, "");
    const pid = Number(suffix);
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) continue;
    rmSync(path.join(root, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function removeRuntimeDist(runtime, created) {
  if (created) rmSync(path.resolve(runtime), { recursive: true, force: true });
}
