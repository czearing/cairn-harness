import { spawn } from "node:child_process";
import path from "node:path";
import { productionNextEnv } from "./production-next-env.mjs";
import {
  createRuntimeDist,
  removeRuntimeDist,
  sweepOrphanedRuntimeDists,
} from "./runtime-dist.mjs";

process.env.HARNESS_ENABLE_SUPERVISOR ??= "1";
process.env.HARNESS_DISCOVER_EXAMPLES ??= "0";

const sourceDist = process.env.NEXT_DIST_DIR || ".next-production";
const runtimeDist = process.env.HARNESS_RUNTIME_DIST_DIR || `.next-runtime-${process.pid}`;
const orphans = sweepOrphanedRuntimeDists(process.cwd(), ".next-runtime-");
if (orphans.length > 0) {
  console.log(`Removed ${orphans.length} orphaned runtime dist directories`);
}
const createdRuntime = createRuntimeDist(sourceDist, runtimeDist);
const activeDist = createdRuntime ?? sourceDist;
const next = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, "start", ...process.argv.slice(2)], {
  env: productionNextEnv(process.env, activeDist),
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  removeRuntimeDist(activeDist, createdRuntime !== null);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
