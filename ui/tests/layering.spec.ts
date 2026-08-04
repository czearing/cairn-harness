import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const viewports = [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
];

test("overlay portals and local popups follow the shared stack", async ({ page }) => {
  const evidence: Array<Record<string, unknown>> = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") {
      requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await page.getByRole("button", { name: "More options for Persona test" }).click();
    const projectMenu = page.getByRole("menu", { name: "Persona test project actions" });
    await expect(projectMenu).toHaveAttribute("data-overlay-layer", "menu");
    await expect(projectMenu).toHaveCSS("z-index", "100");
    const projectMenuInBody = await projectMenu.evaluate((node) => node.parentElement === document.body);
    expect(projectMenuInBody).toBe(true);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "More options for lead" }).click();
    const agentMenu = page.getByRole("menu").filter({ has: page.getByRole("menuitem", { name: /Configure source|View local copy/ }) });
    await expect(agentMenu).toHaveAttribute("data-overlay-layer", "menu");
    await expect(agentMenu).toHaveCSS("z-index", "100");
    const agentMenuZ = await agentMenu.evaluate((node) => getComputedStyle(node).zIndex);
    const agentMenuInBody = await agentMenu.evaluate((node) => node.parentElement === document.body);
    expect(agentMenuInBody).toBe(true);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Open conversation with builder" }).click();
    const drawer = page.getByRole("dialog", { name: "Conversation with builder" });
    const drawerRoot = drawer.locator("..");
    await expect(drawerRoot).toHaveAttribute("data-overlay-layer", "drawer");
    await expect(drawerRoot).toHaveCSS("z-index", "300");
    const drawerInBody = await drawerRoot.evaluate((node) => node.parentElement === document.body);
    expect(drawerInBody).toBe(true);
    await drawer.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "New project" }).click();
    const modal = page.getByRole("dialog", { name: "New project" });
    const modalRoot = modal.locator("..");
    await expect(modalRoot).toHaveAttribute("data-overlay-layer", "modal");
    await expect(modalRoot).toHaveCSS("z-index", "400");
    const modalInBody = await modalRoot.evaluate((node) => node.parentElement === document.body);
    expect(modalInBody).toBe(true);
    const help = modal.locator("[role='tooltip']").locator("..");
    await help.focus();
    const tooltip = modal.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS("z-index", "500");
    const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(accessibility.violations).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    evidence.push({
      viewport,
      overflow,
      accessibilityViolations: accessibility.violations.length,
      projectMenu: { layer: "menu", zIndex: 100, parent: projectMenuInBody ? "body" : "other" },
      agentMenu: { layer: "menu", zIndex: Number(agentMenuZ), parent: agentMenuInBody ? "body" : "other" },
      drawer: { layer: "drawer", zIndex: 300, parent: drawerInBody ? "body" : "other" },
      modal: { layer: "modal", zIndex: 400, parent: modalInBody ? "body" : "other" },
      tooltip: { layer: "tooltip", zIndex: 500, parent: "modal" },
    });
    await modal.getByRole("button", { name: "Close" }).click();
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(requestFailures).toEqual([]);
  console.info(`LAYERING_EVIDENCE=${JSON.stringify({
    evidence,
    consoleErrors,
    pageErrors,
    requestFailures,
  })}`);
});
