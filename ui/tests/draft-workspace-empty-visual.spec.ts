import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const artifactDirectory = path.join(process.cwd(), "test-results", "empty-workbench");

test("zero open drafts leave the Agents workspace unobstructed", async ({ page }) => {
  mkdirSync(artifactDirectory, { recursive: true });
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") networkFailures.push(`${request.method()} ${request.url()}`);
  });
  await page.addInitScript(() => {
    const commits: Array<{ at: number; duration: number }> = [];
    Object.assign(window, { __emptyWorkbenchCommits: commits });
    Object.assign(window, {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        renderers: new Map(),
        inject(renderer: unknown) {
          const id = this.renderers.size + 1;
          this.renderers.set(id, renderer);
          return id;
        },
        onCommitFiberRoot(_id: number, root: { current?: { actualDuration?: number } }) {
          commits.push({ at: performance.now(), duration: root.current?.actualDuration || 0 });
        },
        onCommitFiberUnmount() {},
      },
    });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const evidence: Record<string, unknown> = {};
  for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const workbench = page.getByRole("region", { name: "Draft workbench" });
    while (await workbench.getByRole("button", { name: /^Close draft:/ }).count()) {
      await workbench.getByRole("button", { name: /^Close draft:/ }).first().click();
    }
    await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
    const dom = await page.evaluate(() => {
      const workbench = document.querySelector<HTMLElement>("[data-draft-workbench]")!;
      const rect = workbench.getBoundingClientRect();
      return {
        workbench: { top: rect.top, bottom: rect.bottom, height: rect.height },
        emptyBodyCount: document.querySelectorAll("[class*='emptyDraftWorkspace']").length,
        resizeHandleCount: document.querySelectorAll("[aria-label='Resize draft workbench']").length,
        tabPanelCount: document.querySelectorAll("[data-draft-workbench] [role='tabpanel']").length,
        newDraftCount: document.querySelectorAll("[data-draft-workbench] button").length,
        agentSurfaceCount: document.querySelectorAll("[data-agent-kind]").length,
        overflow: document.documentElement.scrollWidth - innerWidth,
        commits: (window as Window & { __emptyWorkbenchCommits?: unknown[] }).__emptyWorkbenchCommits || [],
      };
    });
    expect(dom.workbench.height).toBeLessThanOrEqual(44);
    expect(dom.workbench.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(dom.emptyBodyCount).toBe(0);
    expect(dom.resizeHandleCount).toBe(0);
    expect(dom.tabPanelCount).toBe(0);
    expect(dom.newDraftCount).toBe(1);
    expect(dom.agentSurfaceCount).toBeGreaterThan(0);
    expect(dom.overflow).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page }).include("main").include("[data-draft-workbench]").analyze();
    expect(axe.violations).toEqual([]);
    const metrics = (await cdp.send("Performance.getMetrics")).metrics
      .filter(({ name }) => ["Nodes", "LayoutCount", "RecalcStyleCount", "TaskDuration", "JSHeapUsedSize"].includes(name));
    const screenshot = path.join(artifactDirectory, `${viewport.name}.png`);
    await page.screenshot({ path: screenshot });
    evidence[viewport.name] = { viewport, dom, metrics, screenshot };
  }
  expect(consoleErrors).toEqual([]);
  expect(networkFailures).toEqual([]);
  writeFileSync(path.join(artifactDirectory, "evidence.json"), JSON.stringify({ ...evidence, consoleErrors, networkFailures }, null, 2));
});
