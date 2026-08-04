import { spawn } from "node:child_process";
import path from "node:path";
import { productionNextEnv } from "./production-next-env.mjs";

const next = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, "build", ...process.argv.slice(2)], {
  env: { ...productionNextEnv(), HARNESS_DISABLE_SUPERVISOR: "1" },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
