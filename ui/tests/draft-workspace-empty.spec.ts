import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("an empty draft workbench collapses without losing its restored height", async ({ page }) => {
  await page.goto("/");
  const projectsBefore = await page.request.get("/api/projects").then((response) => response.json());
  const workbench = page.getByRole("region", { name: "Draft workbench" });
  const spacer = page.locator("[data-draft-workbench-spacer]");
  const initialHeight = await workbench.evaluate((node) => node.getBoundingClientRect().height);
  await workbench.getByRole("button", { name: /^Close draft:/ }).click();

  await expect(workbench.getByText("No drafts", { exact: true })).toBeVisible();
  await expect(workbench.getByRole("button", { name: "New draft" })).toBeFocused();
  await expect(workbench.getByRole("separator", { name: "Resize draft workbench" })).toHaveCount(0);
  await expect(workbench.getByRole("tabpanel")).toHaveCount(0);
  await expect(workbench.getByText("Prepare work before starting it.")).toHaveCount(0);

  const compact = await page.evaluate(() => {
    const workbench = document.querySelector<HTMLElement>("[data-draft-workbench]")!;
    const spacer = document.querySelector<HTMLElement>("[data-draft-workbench-spacer]")!;
    return {
      height: workbench.getBoundingClientRect().height,
      top: workbench.getBoundingClientRect().top,
      spacerHeight: spacer.getBoundingClientRect().height,
      viewportHeight: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(compact.height).toBeLessThanOrEqual(44);
  expect(compact.top).toBeGreaterThanOrEqual(compact.viewportHeight - 45);
  expect(compact.spacerHeight).toBeLessThanOrEqual(44);
  expect(compact.overflow).toBeLessThanOrEqual(0);
  expect((await new AxeBuilder({ page }).include("[data-draft-workbench]").analyze()).violations).toEqual([]);
  const projectsAfter = await page.request.get("/api/projects").then((response) => response.json());
  expect(projectsAfter[0].drafts).toEqual(projectsBefore[0].drafts);

  await page.keyboard.press("Space");
  await expect(workbench.getByRole("textbox", { name: "Draft document" })).toBeFocused();
  await expect(workbench.getByRole("separator", { name: "Resize draft workbench" })).toBeVisible();
  await expect.poll(() => workbench.evaluate((node) => node.getBoundingClientRect().height)).toBe(initialHeight);
  await expect(spacer).not.toHaveAttribute("data-empty");
});
