import { expect, test } from "@playwright/test";

test("draft workbench hides save chrome, aligns tab dividers, and stays resizable", async ({ page }) => {
  await page.goto("/");
  const workbench = page.getByRole("region", { name: "Draft workbench" });
  await workbench.getByRole("button", { name: "New draft" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  await editor.fill("Chrome verification draft");

  await expect(workbench.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  await expect(workbench.getByText("Unsaved", { exact: true })).toHaveCount(0);
  await expect(workbench.getByText("Saved", { exact: true })).toHaveCount(0);
  await expect(workbench.getByText("Saving…", { exact: true })).toHaveCount(0);

  const separator = workbench.getByRole("separator", { name: "Resize draft workbench" });
  await expect(separator).toBeVisible();

  const geometry = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>("[data-draft-workbench]")!;
    const tab = pane.querySelector<HTMLElement>("[data-draft-tab-id]")!;
    const handle = pane.querySelector<HTMLElement>("[aria-label='Resize draft workbench']")!;
    const paneBox = pane.getBoundingClientRect();
    return {
      tabOffset: tab.getBoundingClientRect().top - paneBox.top,
      handleTop: handle.getBoundingClientRect().top - paneBox.top,
      handleWidth: Math.round(handle.getBoundingClientRect().width),
      paneWidth: Math.round(paneBox.width),
      pillOpacity: Number(getComputedStyle(handle, "::after").opacity),
      cursor: getComputedStyle(handle).cursor,
    };
  });
  expect(geometry.tabOffset).toBeLessThanOrEqual(1);
  expect(geometry.handleTop).toBeLessThanOrEqual(1);
  expect(geometry.handleWidth).toBe(geometry.paneWidth);
  expect(geometry.pillOpacity).toBe(0);
  expect(geometry.cursor).toBe("row-resize");

  const before = await page.evaluate(() => document.querySelector<HTMLElement>("[data-draft-workbench]")!.getBoundingClientRect().height);
  await separator.focus();
  await separator.press("ArrowUp");
  await separator.press("ArrowUp");
  const after = await page.evaluate(() => document.querySelector<HTMLElement>("[data-draft-workbench]")!.getBoundingClientRect().height);
  expect(after).toBeGreaterThan(before);

  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
  await page.mouse.up();
  const dragged = await page.evaluate(() => document.querySelector<HTMLElement>("[data-draft-workbench]")!.getBoundingClientRect().height);
  expect(dragged).toBeLessThan(after);
});
