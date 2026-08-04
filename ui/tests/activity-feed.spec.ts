import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("recent activity shows only essential meaningful events newest first", async ({ page }) => {
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const response = await route.fetch();
    const projects = await response.json();
    const project = projects[0];
    const lead = project.agents.find((agent: { id: string }) => agent.id === "lead") || project.agents[0];
    project.activity = [
      { id: 8, agent: lead.id, status: "completed", summary: "Completed deliverable.", completedAt: "2026-07-23T18:20:00Z", chatId: "turn:8" },
      { id: 7, agent: lead.id, status: "completed", summary: "Completed deliverable.", completedAt: "2026-07-23T18:19:00Z", chatId: "turn:7" },
      { id: 6, agent: lead.id, status: "waiting", summary: "Delegated: refine dashboard hierarchy; verify mobile geometry", completedAt: "2026-07-23T18:18:00Z", chatId: "turn:6" },
      { id: 5, agent: lead.id, status: "completed", summary: "Completed deliverable.", completedAt: "2026-07-23T18:17:00Z", chatId: "turn:5" },
      { id: 4, agent: lead.id, status: "completed", summary: "Completed deliverable.", completedAt: "2026-07-23T18:16:00Z", chatId: "turn:4" },
      { id: 3, agent: lead.id, status: "failed", summary: "Activity projection timed out.", completedAt: "2026-07-23T18:15:00Z", chatId: "turn:3" },
    ];
    await route.fulfill({ response, json: projects });
  });

  await page.goto("/");
  const rail = page.getByRole("complementary", { name: "Recent activity" });
  if (!await rail.isVisible()) {
    await page.getByRole("navigation", { name: "Project workspace" }).getByRole("button", { name: "Recent activity" }).click();
  }

  await expect(rail.getByText(/routine completions/i)).toHaveCount(0);
  await expect(rail.getByText("Completed deliverable", { exact: true })).toHaveCount(0);
  await expect(rail.getByText("Delegated Refine dashboard hierarchy", { exact: true })).toBeVisible();
  await expect(rail.getByText("+1", { exact: true })).toBeVisible();
  await expect(rail.getByText("Failed: Activity projection timed out", { exact: true })).toBeVisible();
  await expect(rail.locator("details")).toHaveCount(0);
  await expect(rail.locator('[data-display="dot"]')).toHaveCount(0);
  await expect(rail.locator("strong")).toHaveText([
    "Delegated Refine dashboard hierarchy",
    "Failed: Activity projection timed out",
  ]);

  const accessibility = await new AxeBuilder({ page }).include('[aria-label="Recent activity"]').analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
