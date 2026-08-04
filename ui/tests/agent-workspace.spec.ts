import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("source configuration opens as a prompt-first main workspace", async ({ page }) => {
  const saves: Array<Record<string, unknown>> = [];
  await page.route("**/api/projects/*/agents/lead", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    saves.push(request.postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"revision":2}' });
  });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Configure lead" });
  await trigger.click();

  const workspace = page.getByRole("main", { name: "Lead" });
  const prompt = workspace.getByRole("textbox", { name: "Lead prompt instructions" });
  await expect(workspace).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Configure source/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Draft workbench" })).toHaveCount(0);
  await expect(page.getByText("Recent activity", { exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("heading", { name: "Lead", exact: true })).toBeFocused();
  await expect(workspace.getByRole("tab", { name: /Instructions/ })).toHaveAttribute("aria-selected", "true");
  await expect(workspace.getByRole("heading", { name: "Instructions" })).toBeVisible();

  await prompt.fill("Lead the project with clear delegation and evidence.");
  await expect(workspace.getByRole("status")).toHaveText(/Unsaved changes|Saving changes|All changes saved/);
  await expect.poll(() => saves.some((body) => "instructions" in body)).toBe(true);
  await expect(workspace.getByRole("status")).toHaveText("All changes saved");

  const instructions = workspace.getByRole("tab", { name: /Instructions/ });
  await instructions.focus();
  await instructions.press("ArrowRight");
  await expect(workspace.getByRole("tab", { name: /Profile/ })).toHaveAttribute("aria-selected", "true");
  await expect(workspace.getByRole("heading", { name: "Profile" })).toBeVisible();
  await workspace.getByRole("tab", { name: "Model", exact: true }).click();
  await expect(workspace.getByRole("combobox", { name: "Model" })).toHaveAttribute("data-control", "select");
  await expect(workspace.getByRole("radio")).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await workspace.getByRole("button", { name: "Back to agents" }).click();
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("changing settings sections restores a long workspace to its top", async ({ page }) => {
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const response = await route.fetch();
    const projects = await response.json();
    projects[0].agents = projects[0].agents.map((agent: Record<string, unknown>) => agent.id === "lead"
      ? { ...agent, prompt: Array.from({ length: 120 }, (_, index) => `Instruction ${index + 1}`).join("\n\n") }
      : agent);
    await route.fulfill({ response, json: projects });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Configure lead" }).click();
  const workspace = page.getByRole("main", { name: "Lead" });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => workspace.evaluate((node) => node.scrollTop)).toBe(0);
  expect(await workspace.locator("h1").evaluate((heading) => heading.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await expect(workspace.getByRole("heading", { name: "Lead", exact: true })).toBeFocused();
  await workspace.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await workspace.getByRole("tab", { name: /Profile/ }).click();
  await workspace.getByRole("tab", { name: /Instructions/ }).click();
  await expect.poll(() => workspace.evaluate((node) => node.scrollTop)).toBe(0);
  expect(await workspace.evaluate((node) => Math.abs(node.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
});
