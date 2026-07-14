import { spawn } from "node:child_process";
import path from "node:path";

process.env.HARNESS_ENABLE_SUPERVISOR ??= "1";
process.env.HARNESS_DISCOVER_EXAMPLES ??= "0";

const next = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, "start", ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
