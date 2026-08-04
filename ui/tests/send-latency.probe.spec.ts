import { expect, test } from "@playwright/test";

test("measure warm Create task latency", async ({ page }) => {
  await page.goto("/");
  const measurements: Array<{ save: number; post: number; closure: number; row: number }> = [];

  for (let index = 0; index < 11; index += 1) {
    const body = `Warm latency probe ${index} ${Date.now()}`;
    let postStarted = 0;
    const saveStarts = new Map<import("@playwright/test").Request, number>();
    const requestListener = (request: import("@playwright/test").Request) => {
      if (request.method() === "POST" && request.url().endsWith("/draft/submit")) postStarted = performance.now();
      if (request.method() === "PUT" && request.url().endsWith("/draft")) saveStarts.set(request, performance.now());
    };
    page.on("request", requestListener);
    const editor = page.getByRole("textbox", { name: "Task document" });
    if (!await editor.count()) await page.getByRole("button", { name: "New task" }).click();
    await editor.fill(body);
    const saveResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "PUT" && candidate.url().endsWith("/draft"));
    const submitResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" && candidate.url().endsWith("/draft/submit"));
    const clicked = performance.now();
    await page.getByRole("button", { name: "Create task" }).evaluate((button: HTMLButtonElement) => button.click());
    const saved = await saveResponse;
    const save = performance.now() - (saveStarts.get(saved.request()) || performance.now());
    await submitResponse;
    const post = performance.now() - postStarted;
    await page.waitForFunction(() => {
      const editor = document.querySelector('[contenteditable="true"][aria-label="Task document"]');
      return !editor || !editor.textContent?.trim();
    });
    const closure = performance.now() - clicked;
    await page.waitForFunction((expected) =>
      [...document.querySelectorAll("[data-work-body]")].some((node) => node.textContent === expected), body);
    const row = performance.now() - clicked;
    page.off("request", requestListener);
    measurements.push({ save, post, closure, row });
  }

  const percentile95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const [cold, ...warm] = measurements;
  const result = {
    cold,
    samples: warm.length,
    saveP95: percentile95(warm.map(({ save }) => save)),
    postP95: percentile95(warm.map(({ post }) => post)),
    closureP95: percentile95(warm.map(({ closure }) => closure)),
    rowP95: percentile95(warm.map(({ row }) => row)),
    measurements: warm,
  };
  console.log(`SEND_LATENCY ${JSON.stringify(result)}`);
  expect(result.saveP95).toBeLessThanOrEqual(300);
  expect(result.postP95).toBeLessThanOrEqual(300);
  expect(result.closureP95).toBeLessThanOrEqual(350);
  expect(result.rowP95).toBeLessThanOrEqual(600);
});
