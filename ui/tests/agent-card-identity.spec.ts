import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const artifactDirectory = path.join(process.cwd(), ".e2e-agents-redesign-evidence");

test("agent overview is a concise responsive card grid without clones", async ({ page }) => {
  mkdirSync(artifactDirectory, { recursive: true });
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") networkFailures.push(`${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) networkFailures.push(`${response.status()} ${response.url()}`);
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const response = await route.fetch();
    const projects = await response.json();
    const builder = projects[0].agents.find((agent: Record<string, unknown>) => agent.id === "builder");
    projects[0].agents.push(
      { ...builder, id: "builder-2", kind: "local", sourceAgentId: "builder", instanceOrdinal: 1, title: "Builder copy 1" },
      { ...builder, id: "builder-3", kind: "local", sourceAgentId: "builder", instanceOrdinal: 2, title: "Builder copy 2" },
    );
    await route.fulfill({ response, json: projects });
  });

  const evidence: Record<string, unknown> = {};
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
    { name: "narrow", width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const draftClose = page.getByRole("button", { name: "Close draft: Existing draft task." });
    if (await draftClose.count()) await draftClose.click();

    const builder = page.getByRole("button", { name: "Open conversation with builder" });
    await expect(builder).toBeVisible();
    await expect(page.locator('[data-agent-id="builder-2"]')).toHaveCount(0);
    await expect(page.getByText("Managed copies")).toHaveCount(0);
    await expect(page.getByText(/copy \d/i)).toHaveCount(0);
    const cards = page.locator("[data-agent-variant]");
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThanOrEqual(2);
    await expect(cards.first().getByRole("button")).toHaveCount(2);

    const layout = await cards.evaluateAll((nodes) => {
      const rects = nodes.map((node) => node.getBoundingClientRect());
      return {
        widths: rects.map((rect) => rect.width),
        heights: rects.map((rect) => rect.height),
        overflow: nodes.map((node) => (node as HTMLElement).scrollWidth - (node as HTMLElement).clientWidth),
        columns: new Set(rects.map((rect) => Math.round(rect.x))).size,
      };
    });
    expect(Math.max(...layout.overflow)).toBeLessThanOrEqual(0);
    expect(Math.max(...layout.heights)).toBeLessThanOrEqual(170);
    if (viewport.width <= 390) expect(layout.columns).toBe(1);
    else expect(layout.columns).toBeGreaterThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

    const axe = await new AxeBuilder({ page }).include("main").analyze();
    expect(axe.violations).toEqual([]);
    const screenshot = path.join(artifactDirectory, `${viewport.name}.png`);
    await page.getByRole("heading", { name: "Agents", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshot });
    evidence[viewport.name] = { viewport, cardCount, layout, screenshot };
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with builder" }).click();
  await expect(page.getByRole("textbox", { name: /message/i })).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(networkFailures).toEqual([]);
  writeFileSync(path.join(artifactDirectory, "evidence.json"), JSON.stringify({ ...evidence, consoleErrors, networkFailures }, null, 2));
});
