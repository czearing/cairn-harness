import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const fixture = path.join(process.cwd(), ".e2e", "project.json");
const port = Number(process.env.PLAYWRIGHT_PORT || 3100);

export default defineConfig({
  testDir: "./tests",
  globalTeardown: "./tests/cleanup-fixture.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node tests/setup-fixture.mjs && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: {
      HARNESS_PROJECTS: fixture,
      HARNESS_PROJECT_ROOT: path.join(process.cwd(), ".e2e", "projects"),
      HARNESS_DISCOVER_EXAMPLES: "0",
      HARNESS_DISABLE_AUTOSTART: "1",
      HARNESS_BIN: path.join(process.cwd(), ".e2e", process.platform === "win32" ? "fake-worker.exe" : "fake-worker"),
    },
    timeout: 120000,
  },
});
