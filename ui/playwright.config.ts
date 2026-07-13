import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const fixture = path.join(process.cwd(), ".e2e", "project.json");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node tests/setup-fixture.mjs && npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      HARNESS_PROJECTS: fixture,
      HARNESS_PROJECT_ROOT: path.join(process.cwd(), ".e2e", "projects"),
    },
    timeout: 120000,
  },
});
