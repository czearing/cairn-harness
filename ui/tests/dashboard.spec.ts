import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

test("operator sees project, agents, queues, and activity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Persona test" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "lead" })).toBeVisible();
  await expect(page.getByText("launch.md", { exact: true })).toBeVisible();
  await expect(page.getByText("Delegated launch work.")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    ready: performance.getEntriesByType("navigation")[0]?.duration || 0,
  }));
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(metrics.ready).toBeLessThan(1500);
});

test("project lead adds a work item", async ({ page }) => {
  await page.goto("/");
  const inbox = path.join(process.cwd(), ".e2e", "workspace", "work-items", "inbox");
  const fs = await import("node:fs");
  const before = fs.existsSync(inbox) ? fs.readdirSync(inbox).length : 0;
  await page.getByRole("button", { name: "New work item" }).click();
  await page.getByRole("dialog", { name: "New work item" }).getByRole("textbox").fill("Prepare the launch checklist.");
  await page.getByRole("button", { name: "Add work item" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(() => fs.readdirSync(inbox).length).toBe(before + 1);
});

test("operator messages an individual agent", async ({ page }) => {
  await page.goto("/");
  const dbPath = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "harness.db");
  const before = messageCount(dbPath);
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  await page.getByRole("dialog", { name: "Conversation with lead" }).getByRole("textbox").fill("Confirm the launch order.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => messageCount(dbPath)).toBe(before + 1);
});

test("agent chat shows human and inter-agent history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  await expect(dialog.getByText("Build the launch page.")).toBeVisible();
  await expect(dialog.getByText("Should the launch include mobile?")).toBeVisible();
  await expect(dialog.getByText("Delegated launch work.")).toBeVisible();
  await expect(dialog.getByText("Launch plan attached.")).toBeVisible();
  await expect(dialog.getByText("builder", { exact: true })).toBeVisible();
});

test("todo and activity rows open their full source context", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /build\.todo/ }).click();
  await expect(page.getByRole("dialog", { name: "build.todo" })).toContainText("Build the launch page.");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /Delegated launch work/ }).click();
  const chat = page.getByRole("dialog", { name: "Conversation with lead" });
  const turn = chat.locator('[data-chat-id="turn:1"]');
  await expect(turn).toBeVisible();
  await expect(turn).toBeFocused();
});

test("first-time user creates a project from the rail", async ({ page }, testInfo) => {
  await page.goto("/");
  const name = `Created ${testInfo.project.name}`;
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByLabel("Agents").fill("lead | Project lead | Plan work.\nbuilder | Builder | Build work.");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("failed work mutation keeps the drawer and input", async ({ page }) => {
  await page.route("**/work-items", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Disk unavailable"}' }));
  await page.goto("/");
  await page.getByRole("button", { name: "New work item" }).click();
  const textbox = page.getByRole("dialog", { name: "New work item" }).getByRole("textbox");
  await textbox.fill("Preserve this request.");
  await page.getByRole("button", { name: "Add work item" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Disk unavailable");
  await expect(textbox).toHaveValue("Preserve this request.");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("invalid duplicate agents keep project input visible", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  const name = `Invalid ${testInfo.project.name}`;
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByLabel("Agents").fill("lead | Lead | Plan.\nlead | Other lead | Plan again.");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Agent names must be unique");
  await expect(dialog.getByLabel("Project name")).toHaveValue(name);
});

function messageCount(dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const count = Number((db.prepare("SELECT COUNT(*) count FROM messages WHERE recipient='lead'").get() as { count: number }).count);
  db.close();
  return count;
}
