import { globSync, readFileSync } from "node:fs";
import path from "node:path";

export default function cleanup() {
  const root = path.join(process.cwd(), process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e");
  for (const file of globSync("**/ui-worker.json", { cwd: root })) {
    try {
      const { pid } = JSON.parse(readFileSync(path.join(root, file), "utf8"));
      process.kill(pid);
    } catch {}
  }
}
