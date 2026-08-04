import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function textMetrics(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((node) => node.childNodes.length > 0
        && [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
        && node.getClientRects().length > 0)
      .map((node) => Number.parseFloat(getComputedStyle(node).fontSize))
      .filter(Number.isFinite);
    return {
      minimum: Math.min(...sizes),
      maximum: Math.max(...sizes),
      distinct: [...new Set(sizes)].sort((a, b) => a - b),
      overflow: document.documentElement.scrollWidth - innerWidth,
      overflowing: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 8)
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}:${Math.round(node.getBoundingClientRect().right - innerWidth)}`),
    };
  });
}

test("the shared type scale stays readable across primary application surfaces", async ({ page }) => {
  await page.goto("/");
  const overview = await textMetrics(page);
  expect(overview.minimum).toBeGreaterThanOrEqual(12);
  expect(overview.overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const conversation = await textMetrics(page);
  expect(conversation.minimum).toBeGreaterThanOrEqual(12);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Configure lead" }).click();
  const settings = await textMetrics(page);
  expect(settings.minimum).toBeGreaterThanOrEqual(12);
  expect(settings.distinct.length).toBeLessThanOrEqual(12);
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("the type system reflows at narrow width with enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect.poll(() => textMetrics(page)).toMatchObject({
    minimum: 24,
    overflow: expect.any(Number),
  });
  const metrics = await textMetrics(page);
  expect(metrics.overflow, metrics.overflowing.join("\n")).toBeLessThanOrEqual(0);
});
