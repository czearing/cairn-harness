import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const output = path.join(process.cwd(), process.env.CHAT_EVIDENCE_DIR || ".artifacts-chat-v6");

test("agent chat opens without a virtual history jump", async ({ page }, testInfo) => {
  mkdirSync(output, { recursive: true });
  const projectId = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const requests: Array<{ url: string; method: string; started: number; duration?: number; status?: number }> = [];
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];
  const requestIndex = new Map<string, number>();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") {
      networkFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  page.on("request", (request) => {
    if (!request.url().includes("/messages")) return;
    requestIndex.set(request.url(), requests.push({
      url: request.url(),
      method: request.method(),
      started: Date.now(),
    }) - 1);
  });
  page.on("response", async (response) => {
    const index = requestIndex.get(response.url());
    if (index === undefined) return;
    requests[index].duration = Date.now() - requests[index].started;
    requests[index].status = response.status();
  });
  await page.addInitScript(() => {
    const shifts: Array<{ at: number; value: number }> = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) shifts.push({ at: entry.startTime, value: entry.value });
      }
    }).observe({ type: "layout-shift", buffered: true });
    const commits: number[] = [];
    Object.assign(window, {
      __chatShifts: shifts,
      __chatCommits: commits,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        renderers: new Map(),
        inject(renderer: unknown) {
          const id = this.renderers.size + 1;
          this.renderers.set(id, renderer);
          return id;
        },
        onCommitFiberRoot(_id: number, root: { current?: { actualDuration?: number } }) {
          commits.push(root.current?.actualDuration || 0);
        },
        onCommitFiberUnmount() {},
      },
    });
  });
  await page.setViewportSize(testInfo.project.name === "mobile"
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 });
  if (testInfo.project.name === "mobile") await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const closeDraft = page.getByRole("button", { name: "Close draft: Existing draft task." });
  if (await closeDraft.count()) await closeDraft.click();
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with Lead" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-chat-id]").last()).toBeVisible();
  const samples = await page.evaluate(async () => {
    const ids = new WeakMap<Element, number>();
    let nextId = 1;
    const identify = (node: Element | null) => {
      if (!node) return 0;
      if (!ids.has(node)) ids.set(node, nextId++);
      return ids.get(node)!;
    };
    const rows: Array<Record<string, unknown>> = [];
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const log = document.querySelector<HTMLElement>('[role="log"]');
      const panel = document.querySelector<HTMLElement>('[role="dialog"]');
      const scroller = log?.querySelector<HTMLElement>('[data-virtuoso-scroller="true"]') || log;
      const messages = Array.from(log?.querySelectorAll<HTMLElement>("[data-chat-id]") || []);
      const viewport = log?.getBoundingClientRect();
      const reveal = panel?.querySelector<HTMLElement>("[data-chat-reveal]");
      const fallback = panel?.querySelector<HTMLElement>("[data-chat-paint-surface]");
      const isPainted = (node: HTMLElement | null | undefined) => {
        if (!viewport || !node) return false;
        const rect = node.getBoundingClientRect();
        if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return false;
        for (let current: HTMLElement | null = node; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === "none" || style.visibility === "hidden" || style.contentVisibility === "hidden" || Number(style.opacity) === 0) return false;
          if (current === log) break;
        }
        return true;
      };
      const isPaintedSurface = (node: HTMLElement | null | undefined) => {
        if (!isPainted(node) || !node) return false;
        const style = getComputedStyle(node);
        return style.backgroundImage !== "none" || !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor);
      };
      const visibleMessages = messages.filter(isPainted);
      const revealing = isPaintedSurface(reveal);
      const fallbackPainted = isPaintedSurface(fallback);
      const counts = new Map<string, number>();
      messages.forEach((message) => counts.set(message.dataset.chatId || "", (counts.get(message.dataset.chatId || "") || 0) + 1));
      const visualLast = visibleMessages.at(-1);
      rows.push({
        frame,
        at: performance.now(),
        logId: identify(log),
        scrollerId: identify(scroller),
        mounted: messages.length,
        duplicateMax: Math.max(0, ...counts.values()),
        visible: visibleMessages.length,
        visibleSurface: visibleMessages.length + Number(revealing || fallbackPainted),
        revealing,
        fallback: fallbackPainted,
        following: panel?.querySelector<HTMLElement>("[data-chat-following]")?.dataset.chatFollowing,
        first: messages[0]?.dataset.chatId,
        last: messages.at(-1)?.dataset.chatId,
        visualLast: visualLast?.dataset.chatId,
        visualLastBottom: visualLast && viewport
          ? visualLast.getBoundingClientRect().bottom - viewport.bottom
          : undefined,
        scrollTop: scroller?.scrollTop || 0,
        scrollHeight: scroller?.scrollHeight || 0,
        clientHeight: scroller?.clientHeight || 0,
        active: document.activeElement?.getAttribute("aria-label")
          || document.activeElement?.getAttribute("data-chat-id")
          || document.activeElement?.tagName,
      });
    }
    return {
      rows,
      shifts: (window as Window & { __chatShifts?: unknown[] }).__chatShifts || [],
      commits: (window as Window & { __chatCommits?: number[] }).__chatCommits || [],
      project: document.querySelector("main h1")?.textContent,
      dialog: document.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
    };
  });
  const screenshot = path.join(output, `${testInfo.project.name}.png`);
  writeFileSync(path.join(output, `${testInfo.project.name}-samples.json`), JSON.stringify(samples, null, 2));
  await page.screenshot({ path: screenshot });
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(await dialog.getByLabel("Preparing conversation history").count()).toBe(0);
  expect(await dialog.locator("[data-chat-reveal] article").count()).toBe(0);
  expect(await dialog.locator("[data-chat-reveal] :is(button, a, input, textarea, [tabindex])").count()).toBe(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const opener = page.getByRole("button", { name: "Open conversation with lead" });
  await expect(opener).toBeFocused();
  await opener.click();
  const reopenedHistory = page.getByLabel("Conversation history with lead");
  await expect.poll(() => reopenedHistory.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  const reopenGaps = await reopenedHistory.evaluate(async (node) => {
    const gaps: number[] = [];
    for (let frame = 0; frame < 180; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      gaps.push(node.scrollHeight - node.clientHeight - node.scrollTop);
    }
    return gaps;
  });
  const reopen = {
    active: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName),
    bottomGap: await reopenedHistory.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
    maxLateGap: Math.max(...reopenGaps.slice(30)),
  };
  await page.getByRole("dialog", { name: "Conversation with Lead" }).getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open conversation with builder" }).click();
  await expect(page.getByRole("dialog", { name: "Conversation with Builder" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message builder" })).toBeFocused();
  await page.getByRole("dialog", { name: "Conversation with Builder" }).getByRole("button", { name: "Close", exact: true }).click();
  const navigation = {
    projectId,
    agentId: "builder",
    active: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName),
  };
  const evidence = { url: page.url(), viewport: page.viewportSize(), requests, screenshot, consoleErrors, networkFailures, axe: axe.violations, reopen, navigation, ...samples };
  writeFileSync(path.join(output, `${testInfo.project.name}.json`), JSON.stringify(evidence, null, 2));
  const logIds = new Set(samples.rows.map((sample) => sample.logId).filter(Boolean));
  const scrollTops = samples.rows.map((sample) => Number(sample.scrollTop));
  const lateMovement = Math.max(...scrollTops.slice(30)) - Math.min(...scrollTops.slice(30));
  const finalAnchor = [...samples.rows].reverse().find((sample) => sample.visualLast)?.visualLast;
  const visibleRows = samples.rows.filter((sample) => !sample.revealing && !sample.fallback && sample.visualLast === finalAnchor);
  const visualBottoms = visibleRows.map((sample) => Number(sample.visualLastBottom));
  const visualMovement = Math.max(...visualBottoms) - Math.min(...visualBottoms);
  expect(logIds.size, "virtual history must mount only once").toBe(1);
  expect(Math.max(...samples.rows.map((sample) => Number(sample.duplicateMax))), "message IDs must have one DOM owner").toBe(1);
  expect(Math.min(...samples.rows.map((sample) => Number(sample.visibleSurface))), "every sampled frame must show history or its reveal surface").toBeGreaterThan(0);
  expect(visibleRows.length).toBeGreaterThan(0);
  expect(visualMovement, "the visible bottom message must not jump during virtualization").toBeLessThanOrEqual(1);
  expect(lateMovement, "bottom-anchored history must settle within the first 30 frames").toBeLessThanOrEqual(1);
  expect(axe.violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(networkFailures).toEqual([]);
  expect(reopen.maxLateGap).toBeLessThanOrEqual(2);
  await page.unrouteAll({ behavior: "wait" });
});
